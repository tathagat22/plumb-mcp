/// <reference types="@figma/plugin-typings" />

/**
 * Serialization — a Figma scene node into the REST-shaped model the server
 * normalises.
 *
 * The plugin API and the REST API describe the same document in different
 * shapes, and the server only understands one of them. Everything here exists
 * to make the plugin path produce output `normalize()` cannot tell apart from
 * a REST response: gradient handles reconstructed from the affine transform,
 * font weights derived from style names, bound-variable ids resolved to names.
 */

/* ------------------------------------------------------------------ */
/* Serialization — Figma scene node → the REST-shaped model            */
/* ------------------------------------------------------------------ */

export interface SerialNode {
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

export function weightOf(styleName: string): number {
  return WEIGHTS[styleName.toLowerCase().replace(/\s+|italic|oblique/g, "")] ?? 400;
}

/**
 * Convert a 2×3 affine `gradientTransform` into REST-style handle positions
 * (start, end, width-control) in 0..1 layer space. Mirrors what the REST API
 * already gives us so the downstream gradient-angle math is identity-shared
 * between plugin and REST.
 */
export function handlesFromTransform(
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

export function normalizePaint(p: unknown, varName?: string): unknown {
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

export async function buildVariableMap(): Promise<Map<string, string>> {
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

export function invalidateVariableMapCache(): void {
  variableMapCache = null;
}

/** Look up a variable binding entry's id and resolve it via the map. */
export function varNameFor(binding: unknown, varMap: Map<string, string> | undefined): string | undefined {
  if (!binding || !varMap) return undefined;
  const id = (binding as { id?: unknown }).id;
  if (typeof id !== "string") return undefined;
  return varMap.get(id);
}

export function serializeReactions(node: SceneNode): unknown[] | undefined {
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
export function serialize(
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

  if (node.type === "BOOLEAN_OPERATION" && typeof n.booleanOperation === "string") {
    out.booleanOperation = n.booleanOperation;
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
    if (t.textCase && t.textCase !== figma.mixed && t.textCase !== "ORIGINAL") {
      style.textCase = t.textCase;
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
        "textCase",
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
          if (seg.textCase && seg.textCase !== "ORIGINAL") {
            runStyle.textCase = seg.textCase;
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
