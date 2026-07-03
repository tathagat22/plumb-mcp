/// <reference types="@figma/plugin-typings" />

/**
 * Plumb plugin — main thread.
 *
 * Streams the current selection, the file's screen inventory, and answers the
 * server's on-demand requests for any node and its exported assets. The UI
 * iframe is a pure relay to/from the localhost WebSocket.
 */

import { applyDesign } from "./emit";
import { applyFoundations } from "./foundations";
import { wireMotion } from "./motion-emit";

const PLUGIN_VERSION = "0.13.0";
const PANEL = { w: 240, h: 144 };
const DOT = { w: 60, h: 60 };

figma.showUI(__html__, {
  width: PANEL.w,
  height: PANEL.h,
  title: "Plumb",
  themeColors: true, // inherit Figma's light/dark theme via CSS variables
});

/* ------------------------------------------------------------------ */
/* Serialization — Figma scene node → the REST-shaped model            */
/* ------------------------------------------------------------------ */

interface SerialNode {
  id: string;
  name: string;
  type: string;
  [key: string]: unknown;
}

const WEIGHTS: Record<string, number> = {
  thin: 100, hairline: 100, extralight: 200, ultralight: 200, light: 300,
  normal: 400, regular: 400, book: 400, medium: 500, semibold: 600,
  demibold: 600, bold: 700, extrabold: 800, ultrabold: 800, black: 900, heavy: 900,
};

function weightOf(styleName: string): number {
  return WEIGHTS[styleName.toLowerCase().replace(/\s+|italic|oblique/g, "")] ?? 400;
}

/**
 * Convert a 2×3 affine `gradientTransform` into REST-style handle positions
 * (start, end, width-control) in 0..1 layer space. Mirrors what the REST API
 * already gives us so the downstream gradient-angle math is identity-shared
 * between plugin and REST.
 */
function handlesFromTransform(
  t: readonly [readonly [number, number, number], readonly [number, number, number]] | undefined,
): { x: number; y: number }[] | undefined {
  if (!t || t.length !== 2) return undefined;
  // Invert the affine: world = T · local. We need start (0,0), end (1,0),
  // width (0,1) in LOCAL → apply inverse(T) over the canonical points.
  const [a, b, c] = t[0];
  const [d, e, f] = t[1];
  const det = a * e - b * d;
  if (det === 0) return undefined;
  const inv = (x: number, y: number): { x: number; y: number } => {
    // Inverse of [[a,b,c],[d,e,f]] applied to (x,y,1) → solve T·p = (x,y).
    const px = (e * (x - c) - b * (y - f)) / det;
    const py = (a * (y - f) - d * (x - c)) / det;
    return { x: px, y: py };
  };
  return [inv(0, 0), inv(1, 0), inv(0, 1)];
}

function normalizePaint(p: unknown, varName?: string): unknown {
  if (!p || typeof p !== "object") return p;
  const src = p as Record<string, unknown>;
  const out: Record<string, unknown> = { ...src };
  // Plugin uses `imageHash`; REST uses `imageRef`. Speak REST downstream.
  if (typeof src.imageHash === "string" && !src.imageRef) out.imageRef = src.imageHash;
  // Convert gradientTransform → handlePositions for angle inference.
  if (Array.isArray(src.gradientTransform) && !src.gradientHandlePositions) {
    const hp = handlesFromTransform(
      src.gradientTransform as unknown as
        | readonly [readonly [number, number, number], readonly [number, number, number]]
        | undefined,
    );
    if (hp) out.gradientHandlePositions = hp;
  }
  // Resolved Figma Variable name bound to this paint's color, if any. The
  // server propagates this to the PDS SolidFill so agents reach for a
  // design token instead of the resolved hex.
  if (varName) out.var = varName;
  return out;
}

/**
 * Build a map of `VariableID:xxx` → variable name across all local
 * variables in the current document. Used by `serialize()` to resolve
 * `boundVariables` references without a per-node async lookup.
 *
 * Remote variables (imported from a library) aren't in `getLocalVariables`
 * — bindings to those resolve to undefined and the agent falls back to
 * the hex value. Acceptable for V1.
 *
 * Cached across calls — `getLocalVariablesAsync()` is non-trivial on large
 * design-system files (500+ vars) and `serialize()` is called once per
 * `get-node` request. The cache is invalidated on documentchange (see
 * `start()`), which covers variable creates/renames/deletes; remote-library
 * updates don't fire documentchange but those didn't surface in the cache
 * anyway.
 */
let variableMapCache: Map<string, string> | null = null;

async function buildVariableMap(): Promise<Map<string, string>> {
  if (variableMapCache) return variableMapCache;
  const map = new Map<string, string>();
  try {
    const vars = await figma.variables.getLocalVariablesAsync();
    for (const v of vars) map.set(v.id, v.name);
  } catch {
    // File has no variables or the API is unavailable — return an empty
    // map; bindings will silently no-op.
  }
  variableMapCache = map;
  return map;
}

function invalidateVariableMapCache(): void {
  variableMapCache = null;
}

/** Look up a variable binding entry's id and resolve it via the map. */
function varNameFor(binding: unknown, varMap: Map<string, string> | undefined): string | undefined {
  if (!binding || !varMap) return undefined;
  const id = (binding as { id?: unknown }).id;
  if (typeof id !== "string") return undefined;
  return varMap.get(id);
}

function serializeReactions(node: SceneNode): unknown[] | undefined {
  const r = (node as unknown as { reactions?: unknown }).reactions;
  if (!Array.isArray(r) || r.length === 0) return undefined;
  // Plugin reactions are already shape-compatible with REST after a shallow
  // copy. Filter out the noisy `actions: []` legacy field if present, and
  // preserve overlay positioning (v0.10 Phase 3) when the action opens
  // an overlay — otherwise agents default a destination overlay to a
  // centered modal even when the design pinned it elsewhere.
  return r.map((entry) => {
    if (!entry || typeof entry !== "object") return entry;
    const { actions: _drop, ...rest } = entry as Record<string, unknown>;
    void _drop;
    const action = rest.action as Record<string, unknown> | undefined;
    if (action) {
      // Pull overlay fields onto the action so the normalizer can find them
      // in a single place. Figma uses `overlayRelativePosition` + `overlayBackground`.
      const overlayPos = action.overlayRelativePosition;
      const overlayBg = action.overlayBackground;
      const out: Record<string, unknown> = { ...action };
      if (overlayPos) out.overlayRelativePosition = overlayPos;
      if (overlayBg) out.overlayBackground = overlayBg;
      rest.action = out;
    }
    return rest;
  });
}

/**
 * Serialize a SceneNode to the wire shape.
 *
 * `remainingDepth` (v0.10 Phase 2) bounds the walk so dense screens don't
 * pay full-tree cost when the agent only asked for the top few levels:
 *   - undefined → walk everything (back-compat default)
 *   - N ≥ 1 → include children, recurse with N-1
 *   - 0 → emit this node but omit its `children` array; `childCount` carries
 *     the real count so the server normalizer can still emit `more: N` at
 *     its boundary
 */
function serialize(
  node: SceneNode,
  varMap?: Map<string, string>,
  remainingDepth?: number,
): SerialNode {
  const n = node as unknown as Record<string, any>;
  const out: SerialNode = { id: node.id, name: node.name, type: node.type };

  if (n.visible === false) out.visible = false;

  const bb = n.absoluteBoundingBox;
  if (bb) out.absoluteBoundingBox = { x: bb.x, y: bb.y, width: bb.width, height: bb.height };

  if (n.layoutMode && n.layoutMode !== "NONE") {
    out.layoutMode = n.layoutMode;
    out.itemSpacing = n.itemSpacing;
    out.paddingLeft = n.paddingLeft;
    out.paddingRight = n.paddingRight;
    out.paddingTop = n.paddingTop;
    out.paddingBottom = n.paddingBottom;
    out.primaryAxisAlignItems = n.primaryAxisAlignItems;
    out.counterAxisAlignItems = n.counterAxisAlignItems;
    if (n.layoutWrap) out.layoutWrap = n.layoutWrap;
    if (typeof n.counterAxisSpacing === "number") out.counterAxisSpacing = n.counterAxisSpacing;
  }
  if (n.layoutPositioning === "ABSOLUTE") out.layoutPositioning = "ABSOLUTE";

  // Per-child auto-layout sizing — only meaningful when the parent has
  // auto-layout, but cheap to always emit. Lets agents render flex children
  // with the right grow/stretch/sizing instead of defaulting to "shrink to
  // content" which is the #1 "almost right" layout failure.
  if (typeof n.layoutGrow === "number" && n.layoutGrow > 0) out.layoutGrow = n.layoutGrow;
  if (typeof n.layoutAlign === "string" && n.layoutAlign !== "INHERIT") {
    out.layoutAlign = n.layoutAlign;
  }
  // FIXED is the default and is already implied by box.{w,h}. Only emit
  // when the child stretches (FILL) or shrinks to content (HUG).
  if (n.layoutSizingHorizontal === "FILL" || n.layoutSizingHorizontal === "HUG") {
    out.layoutSizingHorizontal = n.layoutSizingHorizontal;
  }
  if (n.layoutSizingVertical === "FILL" || n.layoutSizingVertical === "HUG") {
    out.layoutSizingVertical = n.layoutSizingVertical;
  }

  // Variable bindings live on the node as `boundVariables.fills[i]` /
  // `boundVariables.strokes[i]`, aligned by index with the paint arrays.
  const bv = n.boundVariables as { fills?: unknown[]; strokes?: unknown[] } | undefined;
  if (Array.isArray(n.fills)) {
    const boundFills = bv?.fills;
    out.fills = n.fills.map((p, i) =>
      normalizePaint(p, varNameFor(Array.isArray(boundFills) ? boundFills[i] : undefined, varMap)),
    );
  }
  if (Array.isArray(n.strokes)) {
    const boundStrokes = bv?.strokes;
    out.strokes = n.strokes.map((p, i) =>
      normalizePaint(p, varNameFor(Array.isArray(boundStrokes) ? boundStrokes[i] : undefined, varMap)),
    );
  }
  if (typeof n.strokeWeight === "number") out.strokeWeight = n.strokeWeight;
  if (typeof n.strokeAlign === "string") out.strokeAlign = n.strokeAlign;
  if (typeof n.strokeTopWeight === "number") out.strokeTopWeight = n.strokeTopWeight;
  if (typeof n.strokeRightWeight === "number") out.strokeRightWeight = n.strokeRightWeight;
  if (typeof n.strokeBottomWeight === "number") out.strokeBottomWeight = n.strokeBottomWeight;
  if (typeof n.strokeLeftWeight === "number") out.strokeLeftWeight = n.strokeLeftWeight;
  if (Array.isArray(n.dashPattern) && n.dashPattern.length > 0) {
    out.dashPattern = n.dashPattern;
  }
  if (typeof n.cornerRadius === "number") {
    out.cornerRadius = n.cornerRadius;
    // Variable-bound uniform corner radius — resolve to a name so the
    // agent can reach for var(--radii-md) instead of a hardcoded px.
    const radiusBinding = (bv as { cornerRadius?: unknown })?.cornerRadius;
    const radiusVar = varNameFor(radiusBinding, varMap);
    if (radiusVar) out.cornerRadiusVar = radiusVar;
  } else if (typeof n.topLeftRadius === "number") {
    out.rectangleCornerRadii = [
      n.topLeftRadius ?? 0,
      n.topRightRadius ?? 0,
      n.bottomRightRadius ?? 0,
      n.bottomLeftRadius ?? 0,
    ];
  }
  if (Array.isArray(n.effects)) out.effects = n.effects;
  if (typeof n.opacity === "number" && n.opacity < 1) out.opacity = n.opacity;
  if (n.clipsContent === true) out.clipsContent = true;

  // v0.10 Phase 3 — fidelity additions. Capture each field only when it
  // diverges from the CSS default so unchanged nodes stay terse.
  // Figma's `rotation` is in radians, anti-clockwise. CSS rotate() is
  // degrees, clockwise. Convert here so the consumer doesn't have to.
  if (typeof n.rotation === "number" && Math.abs(n.rotation) > 0.0001) {
    out.rotation = -(n.rotation * 180) / Math.PI;
  }
  // Blend modes: PASS_THROUGH (frame default) and NORMAL (everything else
  // default) are CSS's implicit blend behaviour — drop those, keep the rest.
  if (typeof n.blendMode === "string" && n.blendMode !== "PASS_THROUGH" && n.blendMode !== "NORMAL") {
    out.blendMode = n.blendMode;
  }
  if (typeof n.cornerSmoothing === "number" && n.cornerSmoothing > 0) {
    out.cornerSmoothing = n.cornerSmoothing;
  }
  if (typeof n.textAutoResize === "string" && n.textAutoResize !== "NONE") {
    out.textAutoResize = n.textAutoResize;
  }
  // Constraints — only meaningful on children of a non-auto-layout parent.
  // The serializer can't know the parent's layout here; emit unconditionally
  // and let the normalizer drop them where they'd be redundant.
  const cons = n.constraints as { horizontal?: string; vertical?: string } | undefined;
  if (cons && (cons.horizontal || cons.vertical)) {
    out.constraints = { horizontal: cons.horizontal, vertical: cons.vertical };
  }
  if (typeof n.minWidth === "number") out.minWidth = n.minWidth;
  if (typeof n.maxWidth === "number") out.maxWidth = n.maxWidth;
  if (typeof n.minHeight === "number") out.minHeight = n.minHeight;
  if (typeof n.maxHeight === "number") out.maxHeight = n.maxHeight;
  // INSTANCE variant selectors — `variantProperties` flattened to a Figma-style
  // key=value record. Plugin only; REST puts the same data in `componentProperties`
  // for VARIANT-type props but the normalizer already pulls those into `props`.
  // The getter throws ("Component set for node has existing errors") when the
  // mainComponent's set is broken — guard or one bad instance kills the walk.
  try {
    const vp = n.variantProperties;
    if (vp && typeof vp === "object") out.variantProperties = vp;
  } catch {
    // Broken component set — skip variant capture for this instance
  }

  if (n.isMask === true) {
    out.isMask = true;
    if (typeof n.maskType === "string") out.maskType = n.maskType;
  }

  // Inline vector path data so agents can render small icons without a
  // round-trip to `plumb_assets`. Only vector-shape types — RECTANGLE /
  // FRAME / GROUP / TEXT / INSTANCE all render via CSS without paths.
  if (
    Array.isArray(n.fillGeometry) &&
    n.fillGeometry.length > 0 &&
    (node.type === "VECTOR" ||
      node.type === "BOOLEAN_OPERATION" ||
      node.type === "STAR" ||
      node.type === "POLYGON" ||
      node.type === "LINE" ||
      node.type === "ELLIPSE")
  ) {
    // Plugin uses `data`, REST uses `path` — speak REST downstream.
    out.fillGeometry = n.fillGeometry.map((g: Record<string, unknown>) => {
      const path = typeof g.path === "string" ? g.path : g.data;
      const item: Record<string, unknown> = {};
      if (typeof path === "string") item.path = path;
      if (typeof g.windingRule === "string") item.windingRule = g.windingRule;
      return item;
    });
  }

  if (node.type === "TEXT") {
    const t = node;
    out.characters = t.characters;
    const style: Record<string, unknown> = {};
    if (typeof t.fontSize === "number") style.fontSize = t.fontSize;
    if (t.fontName !== figma.mixed) {
      style.fontFamily = t.fontName.family;
      style.fontWeight = weightOf(t.fontName.style);
    }
    if (t.lineHeight !== figma.mixed) {
      if (t.lineHeight.unit === "PIXELS") {
        style.lineHeightPx = t.lineHeight.value;
      } else if (t.lineHeight.unit === "PERCENT" && typeof t.fontSize === "number") {
        style.lineHeightPx = (t.fontSize * t.lineHeight.value) / 100;
      }
    }
    if (t.letterSpacing !== figma.mixed && t.letterSpacing.unit === "PIXELS") {
      style.letterSpacing = t.letterSpacing.value;
    }
    style.textAlignHorizontal = t.textAlignHorizontal;
    if (t.textDecoration && t.textDecoration !== figma.mixed && t.textDecoration !== "NONE") {
      style.textDecoration = t.textDecoration;
    }
    out.style = style;

    // v0.10 Phase 3 — capture styled segments so mixed-style text (a bold
    // word inside a sentence, a coloured link, etc.) survives the round-trip
    // instead of silently collapsing to the dominant style. Only emit when
    // there's actually more than one run; single-style text is a no-op.
    try {
      const segments = t.getStyledTextSegments([
        "fontSize",
        "fontName",
        "fills",
        "lineHeight",
        "letterSpacing",
        "textDecoration",
      ]);
      if (segments.length > 1) {
        out.characterRuns = segments.map((seg) => {
          const runStyle: Record<string, unknown> = {};
          if (typeof seg.fontSize === "number") runStyle.fontSize = seg.fontSize;
          if (seg.fontName) {
            runStyle.fontFamily = seg.fontName.family;
            runStyle.fontWeight = weightOf(seg.fontName.style);
          }
          if (seg.lineHeight) {
            if (seg.lineHeight.unit === "PIXELS") {
              runStyle.lineHeightPx = seg.lineHeight.value;
            } else if (
              seg.lineHeight.unit === "PERCENT" &&
              typeof seg.fontSize === "number"
            ) {
              runStyle.lineHeightPx = (seg.fontSize * seg.lineHeight.value) / 100;
            }
          }
          if (seg.letterSpacing && seg.letterSpacing.unit === "PIXELS") {
            runStyle.letterSpacing = seg.letterSpacing.value;
          }
          if (seg.textDecoration && seg.textDecoration !== "NONE") {
            runStyle.textDecoration = seg.textDecoration;
          }
          const runOut: Record<string, unknown> = {
            characters: seg.characters,
            style: runStyle,
          };
          // Per-run fills — only emit when this segment's fills diverge from
          // the node's dominant fills. The normalizer interns matching fills
          // to the same colour token so identical runs don't duplicate.
          if (Array.isArray(seg.fills) && seg.fills.length > 0) {
            runOut.fills = seg.fills.map((p) => normalizePaint(p, undefined));
          }
          return runOut;
        });
      }
    } catch {
      // getStyledTextSegments can throw on certain placeholder text nodes
      // (e.g. missing fonts not yet loaded). Single-style fallback wins.
    }
  }

  if (node.type === "INSTANCE") {
    try {
      const main = (node as InstanceNode).mainComponent;
      if (main) out.componentId = main.id;
    } catch {
      // mainComponent can throw on dynamic-page documents — skip
    }
    // Property override values — variant, text, boolean, instance-swap.
    // The normalizer strips Figma's internal `#id:idx` key suffix.
    // Same caveat as variantProperties: can throw on instances whose
    // component-set has errors.
    try {
      const props = (node as InstanceNode).componentProperties;
      if (props && typeof props === "object" && Object.keys(props).length > 0) {
        out.componentProperties = props;
      }
    } catch {
      // Broken component set — skip prop capture for this instance
    }
  }

  const reactions = serializeReactions(node);
  if (reactions) out.reactions = reactions;

  if ("children" in node) {
    const kids = (node as ChildrenMixin).children;
    if (kids.length > 0) {
      if (remainingDepth === 0) {
        // Depth limit hit at this node — omit children, hand the count to
        // the server so its normalizer can still produce a `more` marker
        // without re-fetching.
        out.childCount = kids.length;
      } else {
        const next = remainingDepth === undefined ? undefined : remainingDepth - 1;
        // Defense in depth — one broken descendant should not abort the whole
        // screen walk. If a child throws, emit a minimal stub and keep going.
        out.children = kids.map((kid) => {
          try {
            return serialize(kid, varMap, next);
          } catch {
            return { id: kid.id, name: kid.name, type: kid.type } as SerialNode;
          }
        });
      }
    }
  }

  return out;
}

/* ------------------------------------------------------------------ */
/* Inventory — every screen in the file                               */
/* ------------------------------------------------------------------ */

const SCREEN_TYPES = ["FRAME", "COMPONENT", "INSTANCE"];

function frameEntry(n: any): { id: string; name: string; w: number; h: number } {
  const bb = n.absoluteBoundingBox;
  return {
    id: n.id,
    name: n.name,
    w: bb ? Math.round(bb.width) : 0,
    h: bb ? Math.round(bb.height) : 0,
  };
}

function collectScreens(page: any): { id: string; name: string; w: number; h: number }[] {
  const out: { id: string; name: string; w: number; h: number }[] = [];
  for (const child of page.children) {
    if (child.visible === false) continue;
    if (child.type === "SECTION" && Array.isArray(child.children)) {
      for (const inner of child.children) {
        if (inner.visible !== false && SCREEN_TYPES.indexOf(inner.type) !== -1) {
          out.push(frameEntry(inner));
        }
      }
    } else if (SCREEN_TYPES.indexOf(child.type) !== -1) {
      out.push(frameEntry(child));
    }
  }
  return out;
}

function pushInventory(): void {
  const pages = figma.root.children.map((page) => ({
    id: page.id,
    name: page.name,
    frames: collectScreens(page),
  }));
  figma.ui.postMessage({ type: "inventory", fileName: figma.root.name, pages });
}

function pushSelection(): void {
  const selection = figma.currentPage.selection;
  const node = selection.length > 0 ? selection[0] : null;
  figma.ui.postMessage({
    type: "selection",
    doc: node ? serialize(node) : null,
    fileName: figma.root.name,
    pageName: figma.currentPage.name,
    nodeName: node ? node.name : null,
    pluginVersion: PLUGIN_VERSION,
  });
}

/* ------------------------------------------------------------------ */
/* Assets — export icons (SVG) and images (PNG)                        */
/* ------------------------------------------------------------------ */

interface WireAsset {
  id: string;
  name: string;
  format: "SVG" | "PNG" | "JPG" | "GIF" | "WEBP";
  /** Bridge fills this in from the HTTP upload — plugin always sends null. */
  path: null;
  /** The id of the nearest ancestor that was also exported. */
  parentId?: string;
}

const VECTOR_TYPES = ["VECTOR", "BOOLEAN_OPERATION", "STAR", "LINE", "POLYGON"];
const CONTAINER_TYPES = ["FRAME", "GROUP", "INSTANCE", "COMPONENT"];
const MAX_ASSETS = 300;

function hasImageFill(n: any): boolean {
  return (
    Array.isArray(n.fills) &&
    n.fills.some((f: any) => f && f.type === "IMAGE" && f.visible !== false)
  );
}

/** Returns the `imageHash` of the first visible IMAGE fill, or null. The hash
 *  is the key into `figma.getImageByHash()` — i.e. the original uploaded
 *  bytes, not a rasterisation. */
function firstImageHash(n: any): string | null {
  if (!Array.isArray(n.fills)) return null;
  for (const f of n.fills) {
    if (f && f.type === "IMAGE" && f.visible !== false && typeof f.imageHash === "string") {
      return f.imageHash;
    }
  }
  return null;
}

/** Detect the on-the-wire format of raw image bytes from their magic numbers
 *  so the bridge writes the right file extension. Falls back to PNG if the
 *  signature is unrecognised (Figma's image fills are virtually always one of
 *  PNG / JPG / GIF / WEBP). */
function detectImageFormat(bytes: Uint8Array): "PNG" | "JPG" | "GIF" | "WEBP" {
  if (bytes.length >= 4) {
    // JPEG: FF D8 FF ..
    if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "JPG";
    // PNG: 89 50 4E 47 ..
    if (
      bytes[0] === 0x89 && bytes[1] === 0x50 &&
      bytes[2] === 0x4e && bytes[3] === 0x47
    ) return "PNG";
    // GIF: "GIF8"
    if (
      bytes[0] === 0x47 && bytes[1] === 0x49 &&
      bytes[2] === 0x46 && bytes[3] === 0x38
    ) return "GIF";
    // WEBP: "RIFF" .... "WEBP" at offset 8
    if (
      bytes.length >= 12 &&
      bytes[0] === 0x52 && bytes[1] === 0x49 &&
      bytes[2] === 0x46 && bytes[3] === 0x46 &&
      bytes[8] === 0x57 && bytes[9] === 0x45 &&
      bytes[10] === 0x42 && bytes[11] === 0x50
    ) return "WEBP";
  }
  return "PNG";
}

/** A container counts as an icon/illustration: vector art, no text, bounded. */
function isIconSubtree(n: any): boolean {
  let count = 0;
  let hasVector = false;
  let ok = true;
  function walk(x: any): void {
    if (!ok) return;
    if (++count > 200) { ok = false; return; }
    if (x.type === "TEXT" || hasImageFill(x)) { ok = false; return; }
    if (VECTOR_TYPES.indexOf(x.type) !== -1) hasVector = true;
    if (Array.isArray(x.children)) for (const c of x.children) walk(c);
  }
  walk(n);
  return ok && hasVector;
}

/** Designer-created GROUP nodes are intentional groupings — export the whole
 *  group as one SVG whenever it contains vectors and no text, regardless of
 *  size. This preserves multi-layer icon groups instead of fragmenting them. */
function isVectorGroup(n: any): boolean {
  if (n.type !== "GROUP") return false;
  let hasVector = false;
  let hasText = false;
  function walk(x: any): void {
    if (hasText) return;
    if (x.type === "TEXT") { hasText = true; return; }
    if (VECTOR_TYPES.indexOf(x.type) !== -1) hasVector = true;
    if (Array.isArray(x.children)) for (const c of x.children) walk(c);
  }
  walk(n);
  return hasVector && !hasText;
}

function settingsFormat(n: any): "SVG" | "PNG" {
  if (Array.isArray(n.exportSettings)) {
    for (const s of n.exportSettings) if (s && s.format === "SVG") return "SVG";
  }
  return "PNG";
}

/** ackKey (`${reqId}-${index}`) → resolver that fires when the UI confirms
 *  the matching /upload POST completed. Serialising on this ack keeps Figma's
 *  postMessage IPC from buffering 100+ Uint8Arrays and redelivering them. */
const uploadAcks = new Map<string, (error: string | null) => void>();

/** Ship a Uint8Array up to the bridge over the HTTP binary-upload channel.
 *  Awaits the per-item ack so Figma's IPC can't buffer + redeliver. */
async function uploadBytes(
  bytes: Uint8Array,
  ext: string,
  reqId: string,
  index: number,
): Promise<void> {
  const ackKey = `${reqId}-${index}`;
  const ack = new Promise<void>((resolve, reject) => {
    uploadAcks.set(ackKey, (error) => (error ? reject(new Error(error)) : resolve()));
  });
  figma.ui.postMessage({
    type: "upload-asset",
    reqId,
    index,
    bytes,
    ext,
  });
  await ack;
}

/** Export a node via exportAsync (rendered PNG/SVG) and ship the bytes. */
async function exportAndUpload(
  n: any,
  format: "SVG" | "PNG",
  reqId: string,
  index: number,
): Promise<WireAsset> {
  const settings: any =
    format === "SVG"
      ? { format: "SVG" }
      : { format: "PNG", constraint: { type: "SCALE", value: 2 } };
  const bytes: Uint8Array = await n.exportAsync(settings);
  await uploadBytes(bytes, format === "SVG" ? "svg" : "png", reqId, index);
  return { id: n.id, name: n.name, format, path: null };
}

/** Ship the *original uploaded image* for a node's first IMAGE fill — bypasses
 *  exportAsync entirely. Useful when an agent needs the asset that was
 *  uploaded into Figma (e.g. a profile photo) rather than a 2× re-render. */
async function extractRawImageAndUpload(
  n: any,
  reqId: string,
  index: number,
): Promise<WireAsset | null> {
  const hash = firstImageHash(n);
  if (!hash) return null;
  const image = figma.getImageByHash(hash);
  if (!image) return null;
  const bytes = await image.getBytesAsync();
  const format = detectImageFormat(bytes);
  const ext = format === "PNG" ? "png" : format === "JPG" ? "jpg" : format === "GIF" ? "gif" : "webp";
  await uploadBytes(bytes, ext, reqId, index);
  return { id: n.id, name: n.name, format, path: null };
}

function pickFormatForNode(n: any): "SVG" | "PNG" {
  if (Array.isArray(n.exportSettings) && n.exportSettings.length > 0) {
    return settingsFormat(n);
  }
  if (hasImageFill(n)) return "PNG";
  // Default: SVG — Figma can export almost any node as SVG.
  return "SVG";
}

/** Surgical mode — export exactly these ids, one asset each, no recursion. */
async function collectSpecific(
  ids: string[],
  reqId: string,
  list: boolean,
  raw: boolean,
): Promise<WireAsset[]> {
  const assets: WireAsset[] = [];
  for (const id of ids) {
    if (assets.length >= MAX_ASSETS) break;
    const node = await figma.getNodeByIdAsync(id);
    if (!node || node.type === "PAGE" || node.type === "DOCUMENT") continue;
    const n = node as any;
    if (n.visible === false) continue;
    const format = pickFormatForNode(n);
    if (list) {
      assets.push({ id: n.id, name: n.name, format, path: null });
      continue;
    }
    if (raw && hasImageFill(n)) {
      const rawAsset = await extractRawImageAndUpload(n, reqId, assets.length);
      if (rawAsset) {
        assets.push(rawAsset);
        continue;
      }
      // Fall through to a rendered export if the hash couldn't be resolved.
    }
    assets.push(await exportAndUpload(n, format, reqId, assets.length));
  }
  return assets;
}

async function collectAssets(
  root: SceneNode,
  reqId: string,
  opts: { list?: boolean; raw?: boolean } = {},
): Promise<WireAsset[]> {
  const assets: WireAsset[] = [];

  /**
   * Always descend — even after exporting — so nested groups are collected.
   * The user's spec: "go inside groups, export, go deeper, repeat".
   * Tweak: standalone VECTOR nodes are exported only when no ancestor was
   * exported — otherwise they are already contained in that ancestor's SVG.
   * With `list: true`, we record the same candidates but skip exportAsync.
   */
  async function visit(
    n: any,
    isRoot: boolean,
    ancestorExported: boolean,
    ancestorId: string | undefined,
  ): Promise<void> {
    if (assets.length >= MAX_ASSETS || n.visible === false) return;

    let format: "SVG" | "PNG" | null = null;
    if (!isRoot) {
      const hasExport = Array.isArray(n.exportSettings) && n.exportSettings.length > 0;
      if (hasExport) {
        format = settingsFormat(n);
      } else if (isVectorGroup(n)) {
        format = "SVG";
      } else if (CONTAINER_TYPES.indexOf(n.type) !== -1 && isIconSubtree(n)) {
        format = "SVG";
      } else if (VECTOR_TYPES.indexOf(n.type) !== -1 && !ancestorExported) {
        format = "SVG";
      } else if (hasImageFill(n)) {
        format = "PNG";
      }
    }

    let nextAncestorId = ancestorId;
    let exportedHere = false;
    if (format) {
      let asset: WireAsset;
      if (opts.list) {
        asset = { id: n.id, name: n.name, format, path: null };
      } else if (opts.raw && hasImageFill(n)) {
        const rawAsset = await extractRawImageAndUpload(n, reqId, assets.length);
        asset = rawAsset ?? await exportAndUpload(n, format, reqId, assets.length);
      } else {
        asset = await exportAndUpload(n, format, reqId, assets.length);
      }
      if (ancestorId) asset.parentId = ancestorId;
      assets.push(asset);
      exportedHere = true;
      nextAncestorId = n.id;
    }

    if (Array.isArray(n.children)) {
      for (const c of n.children) {
        await visit(c, false, exportedHere || ancestorExported, nextAncestorId);
      }
    }
  }

  await visit(root, true, false, undefined);
  return assets;
}

/* ------------------------------------------------------------------ */
/* Server requests, relayed through the UI iframe                      */
/* ------------------------------------------------------------------ */

function reply(message: unknown): void {
  figma.ui.postMessage({ type: "plugin-reply", reply: message });
}

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

async function handleGetScreenshot(
  reqId: string,
  nodeId: string,
  scale?: number,
  format?: "PNG" | "JPG",
): Promise<void> {
  try {
    const node = await figma.getNodeByIdAsync(nodeId);
    if (!node || node.type === "PAGE" || node.type === "DOCUMENT") {
      reply({ t: "screenshot", reqId, format: "", nodeName: null, error: "node not found" });
      return;
    }
    const f = format ?? "PNG";
    const s = scale ?? 2;
    const settings: any = { format: f, constraint: { type: "SCALE", value: s } };
    const bytes: Uint8Array = await (node as any).exportAsync(settings);
    // Ship the raw bytes through the UI iframe and out over loopback HTTP — no
    // base64. The UI will send the matching `screenshot` WS reply once the
    // upload completes; the bridge resolves the pending promise with the
    // on-disk path it wrote.
    figma.ui.postMessage({
      type: "upload-screenshot",
      reqId,
      bytes,
      format: f,
      nodeName: (node as any).name ?? null,
    });
  } catch (e) {
    reply({ t: "screenshot", reqId, format: "", nodeName: null, error: errMsg(e) });
  }
}

async function handleGetSearch(
  reqId: string,
  query?: string,
  type?: string,
): Promise<void> {
  try {
    const q = (query ?? "").trim().toLowerCase();
    const t = (type ?? "").toUpperCase();
    const matches: any[] = [];
    const MAX = 50;
    function visit(n: any, page: string, parent: string): void {
      if (matches.length >= MAX) return;
      if (n.visible === false) return;
      const nameOk = !q || ((n.name ?? "") as string).toLowerCase().indexOf(q) !== -1;
      const typeOk = !t || n.type === t;
      if (nameOk && typeOk && n.type !== "PAGE" && n.type !== "DOCUMENT") {
        const bb = n.absoluteBoundingBox;
        const m: any = {
          id: n.id,
          name: n.name,
          type: n.type,
          page,
          w: bb ? Math.round(bb.width) : 0,
          h: bb ? Math.round(bb.height) : 0,
        };
        if (parent) m.parentName = parent;
        matches.push(m);
      }
      // Skip INSTANCE children — they are component mirrors that would flood results.
      if (Array.isArray(n.children) && n.type !== "INSTANCE") {
        for (const c of n.children) visit(c, page, n.name);
      }
    }
    for (const page of figma.root.children) {
      for (const child of page.children) visit(child, page.name, "");
    }
    reply({ t: "search", reqId, matches, error: null });
  } catch (e) {
    reply({ t: "search", reqId, matches: [], error: errMsg(e) });
  }
}

async function handleGetComponents(reqId: string): Promise<void> {
  try {
    const components: any[] = [];
    const instanceNodes: any[] = []; // collect first, resolve mainComponent after
    const instanceCount = new Map<string, number>();

    function visit(n: any, page: string): void {
      if (n.visible === false) return;
      if (n.type === "COMPONENT" || n.type === "COMPONENT_SET") {
        const bb = n.absoluteBoundingBox;
        const c: any = {
          id: n.id,
          name: n.name,
          page,
          w: bb ? Math.round(bb.width) : 0,
          h: bb ? Math.round(bb.height) : 0,
          instanceCount: 0,
        };
        if (n.description) c.description = n.description;
        components.push(c);
      } else if (n.type === "INSTANCE") {
        instanceNodes.push({ node: n, page });
      }
      if (Array.isArray(n.children) && n.type !== "INSTANCE") {
        for (const c of n.children) visit(c, page);
      }
    }
    for (const page of figma.root.children) {
      for (const child of page.children) visit(child, page.name);
    }

    // Under documentAccess: "dynamic-page", `n.mainComponent` (sync) throws.
    // Use the async variant — and resolve them in parallel batches, because
    // sequential `await` over 10k+ instances will time out the MCP client
    // (the 60s default isn't enough at 5–50 ms per page-load).
    const BATCH = 64;
    const resolved: Array<{ n: any; page: string; main: any | null }> = [];
    for (let i = 0; i < instanceNodes.length; i += BATCH) {
      const slice = instanceNodes.slice(i, i + BATCH);
      const mains = await Promise.all(
        slice.map(({ node: n }) =>
          (n as InstanceNode)
            .getMainComponentAsync()
            .catch(() => null),
        ),
      );
      for (let j = 0; j < slice.length; j++) {
        resolved.push({ n: slice[j]!.node, page: slice[j]!.page, main: mains[j] });
      }
    }
    const instances: any[] = [];
    for (const { n, page, main } of resolved) {
      if (!main) continue; // deleted / orphaned / unresolvable
      instances.push({ id: n.id, name: n.name, componentId: main.id, page });
      instanceCount.set(main.id, (instanceCount.get(main.id) ?? 0) + 1);
    }
    for (const c of components) c.instanceCount = instanceCount.get(c.id) ?? 0;

    reply({ t: "components", reqId, components, instances, error: null });
  } catch (e) {
    reply({ t: "components", reqId, components: [], instances: [], error: errMsg(e) });
  }
}

/** Serialize main-thread operations that produce upload streams across all
 *  paired sessions. Without this, two MCP servers each kicking off `get-assets`
 *  at once would interleave their per-asset upload-ack chains; Figma's IPC
 *  has already been observed buffering & redelivering postMessages under
 *  pressure (see ui.html and the upload-ack gating there). Reads (get-node,
 *  get-search, get-components) skip the queue so a quick lookup from session
 *  B isn't stuck behind a 400ms export from session A. */
let uploadOpQueue: Promise<unknown> = Promise.resolve();
function queueUploadOp<T>(fn: () => Promise<T>): Promise<T> {
  const next = uploadOpQueue.then(fn, fn);
  uploadOpQueue = next.catch(() => undefined);
  return next;
}

async function dispatchServerRequest(req: any): Promise<void> {
  if (!req || typeof req.t !== "string") return;
  // Heavy mutations + exports share the UI↔IPC byte channel and must not
  // interleave across sessions — serialize them through the upload queue.
  if (
    req.t === "get-assets" ||
    req.t === "get-screenshot" ||
    req.t === "apply-design" ||
    req.t === "apply-foundations" ||
    req.t === "apply-motion"
  ) {
    await queueUploadOp(() => handleServerRequest(req));
    return;
  }
  await handleServerRequest(req);
}

async function handleServerRequest(req: any): Promise<void> {
  if (!req || typeof req.t !== "string") return;

  if (req.t === "get-node") {
    const node = await figma.getNodeByIdAsync(req.nodeId);
    if (!node || node.type === "PAGE" || node.type === "DOCUMENT") {
      reply({ t: "node", reqId: req.reqId, doc: null, nodeName: null });
      return;
    }
    const scene = node as SceneNode;
    const varMap = await buildVariableMap();
    reply({
      t: "node",
      reqId: req.reqId,
      doc: serialize(
        scene,
        varMap,
        typeof req.depth === "number" ? req.depth : undefined,
      ),
      nodeName: scene.name,
    });
    return;
  }

  if (req.t === "get-assets") {
    try {
      const list = req.list === true;
      const raw = req.raw === true;
      const ids: string[] | undefined = Array.isArray(req.ids) ? req.ids : undefined;

      if (ids && ids.length > 0) {
        const assets = await collectSpecific(ids, req.reqId, list, raw);
        reply({ t: "assets", reqId: req.reqId, assets, error: null });
        return;
      }

      const node = await figma.getNodeByIdAsync(req.nodeId);
      if (!node || node.type === "PAGE" || node.type === "DOCUMENT") {
        reply({ t: "assets", reqId: req.reqId, assets: [], error: "node not found" });
        return;
      }
      const assets = await collectAssets(node as SceneNode, req.reqId, { list, raw });
      reply({ t: "assets", reqId: req.reqId, assets, error: null });
    } catch (e) {
      reply({
        t: "assets",
        reqId: req.reqId,
        assets: [],
        error: e instanceof Error ? e.message : String(e),
      });
    }
    return;
  }

  if (req.t === "get-screenshot") {
    await handleGetScreenshot(req.reqId, req.nodeId, req.scale, req.format);
    return;
  }

  if (req.t === "get-search") {
    await handleGetSearch(req.reqId, req.query, req.type);
    return;
  }

  if (req.t === "get-components") {
    await handleGetComponents(req.reqId);
    return;
  }

  // ---- Write direction: three sequenced mutations ------------------------
  if (req.t === "apply-design") {
    try {
      const result = await applyDesign(req.plan, (phase, done, total, note) =>
        reply({ t: "apply-progress", reqId: req.reqId, phase, done, total, note }),
      );
      reply({ t: "applied", reqId: req.reqId, result, error: null });
    } catch (e) {
      reply({ t: "applied", reqId: req.reqId, result: null, error: errMsg(e) });
    }
    return;
  }

  if (req.t === "apply-foundations") {
    try {
      const result = await applyFoundations(req.plan, req.dryRun);
      reply({ t: "foundations", reqId: req.reqId, result, error: null });
    } catch (e) {
      reply({ t: "foundations", reqId: req.reqId, result: null, error: errMsg(e) });
    }
    return;
  }

  if (req.t === "apply-motion") {
    try {
      const idMap = new Map<string, string>(Object.entries(req.idMap ?? {}));
      const result = await wireMotion(req.plan, idMap);
      reply({ t: "motion", reqId: req.reqId, result, error: null });
    } catch (e) {
      reply({ t: "motion", reqId: req.reqId, result: null, error: errMsg(e) });
    }
    return;
  }
}

/* ------------------------------------------------------------------ */
/* UI messages + startup                                               */
/* ------------------------------------------------------------------ */

figma.ui.onmessage = (message: {
  type?: string;
  req?: unknown;
  reqId?: string;
  index?: number;
  error?: string | null;
}) => {
  if (!message || typeof message.type !== "string") return;
  switch (message.type) {
    case "resync":
      pushSelection();
      pushInventory();
      break;
    case "collapse":
      figma.ui.resize(DOT.w, DOT.h);
      break;
    case "expand":
      figma.ui.resize(PANEL.w, PANEL.h);
      break;
    case "paired":
      void figma.clientStorage.setAsync("plumb-paired", true);
      break;
    case "server-request":
      void dispatchServerRequest(message.req);
      break;
    case "upload-ack": {
      const key = `${message.reqId}-${message.index}`;
      const resolve = uploadAcks.get(key);
      if (resolve) {
        uploadAcks.delete(key);
        resolve(message.error ?? null);
      }
      break;
    }
  }
};

async function start(): Promise<void> {
  // documentAccess "dynamic-page" requires all pages loaded before the
  // document-wide change handler — and before reading other pages' children.
  await figma.loadAllPagesAsync();

  const wasPaired = (await figma.clientStorage.getAsync("plumb-paired")) === true;
  figma.ui.postMessage({ type: "init", autoPair: wasPaired });

  figma.on("selectionchange", pushSelection);

  let changeTimer: ReturnType<typeof setTimeout> | null = null;
  figma.on("documentchange", () => {
    // Drop the variable-map cache on every documentchange — cheap to rebuild
    // and ensures variable renames/creates/deletes are picked up by the next
    // `get-node`. Selection/inventory pushes are still debounced.
    invalidateVariableMapCache();
    if (changeTimer !== null) clearTimeout(changeTimer);
    changeTimer = setTimeout(() => {
      pushSelection();
      pushInventory();
    }, 400);
  });

  pushSelection();
  pushInventory();
}

void start();
