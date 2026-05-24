/// <reference types="@figma/plugin-typings" />

/**
 * Plumb plugin — main thread.
 *
 * Streams the current selection, the file's screen inventory, and answers the
 * server's on-demand requests for any node and its exported assets. The UI
 * iframe is a pure relay to/from the localhost WebSocket.
 */

const PLUGIN_VERSION = "0.0.1";
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

function normalizePaint(p: unknown): unknown {
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
  return out;
}

function serializeReactions(node: SceneNode): unknown[] | undefined {
  const r = (node as unknown as { reactions?: unknown }).reactions;
  if (!Array.isArray(r) || r.length === 0) return undefined;
  // Plugin reactions are already shape-compatible with REST after a shallow
  // copy. Filter out the noisy `actions: []` legacy field if present.
  return r.map((entry) => {
    if (!entry || typeof entry !== "object") return entry;
    const { actions: _drop, ...rest } = entry as Record<string, unknown>;
    void _drop;
    return rest;
  });
}

function serialize(node: SceneNode): SerialNode {
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

  if (Array.isArray(n.fills)) out.fills = n.fills.map(normalizePaint);
  if (Array.isArray(n.strokes)) out.strokes = n.strokes.map(normalizePaint);
  if (typeof n.strokeWeight === "number") out.strokeWeight = n.strokeWeight;
  if (typeof n.cornerRadius === "number") {
    out.cornerRadius = n.cornerRadius;
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
  }

  if (node.type === "INSTANCE") {
    try {
      const main = (node as InstanceNode).mainComponent;
      if (main) out.componentId = main.id;
    } catch {
      // mainComponent can throw on dynamic-page documents — skip
    }
  }

  const reactions = serializeReactions(node);
  if (reactions) out.reactions = reactions;

  if ("children" in node) {
    const kids = (node as ChildrenMixin).children;
    if (kids.length > 0) out.children = kids.map(serialize);
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
  if (req.t === "get-assets" || req.t === "get-screenshot") {
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
    reply({ t: "node", reqId: req.reqId, doc: serialize(scene), nodeName: scene.name });
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
