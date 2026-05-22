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

  if (Array.isArray(n.fills)) out.fills = n.fills;
  if (Array.isArray(n.strokes)) out.strokes = n.strokes;
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
  format: "SVG" | "PNG";
  dataBase64: string;
  /** The id of the nearest ancestor that was also exported. */
  parentId?: string;
}

const VECTOR_TYPES = ["VECTOR", "BOOLEAN_OPERATION", "STAR", "LINE", "POLYGON"];
const CONTAINER_TYPES = ["FRAME", "GROUP", "INSTANCE", "COMPONENT"];
const MAX_ASSETS = 300;

const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
function toBase64(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i];
    const b1 = i + 1 < bytes.length ? bytes[i + 1] : 0;
    const b2 = i + 2 < bytes.length ? bytes[i + 2] : 0;
    out += B64[b0 >> 2];
    out += B64[((b0 & 3) << 4) | (b1 >> 4)];
    out += i + 1 < bytes.length ? B64[((b1 & 15) << 2) | (b2 >> 6)] : "=";
    out += i + 2 < bytes.length ? B64[b2 & 63] : "=";
  }
  return out;
}

function hasImageFill(n: any): boolean {
  return (
    Array.isArray(n.fills) &&
    n.fills.some((f: any) => f && f.type === "IMAGE" && f.visible !== false)
  );
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

async function exportNode(n: any, format: "SVG" | "PNG"): Promise<WireAsset> {
  const settings: any =
    format === "SVG"
      ? { format: "SVG" }
      : { format: "PNG", constraint: { type: "SCALE", value: 2 } };
  const bytes: Uint8Array = await n.exportAsync(settings);
  return { id: n.id, name: n.name, format, dataBase64: toBase64(bytes) };
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
async function collectSpecific(ids: string[], list: boolean): Promise<WireAsset[]> {
  const assets: WireAsset[] = [];
  for (const id of ids) {
    if (assets.length >= MAX_ASSETS) break;
    const node = await figma.getNodeByIdAsync(id);
    if (!node || node.type === "PAGE" || node.type === "DOCUMENT") continue;
    const n = node as any;
    if (n.visible === false) continue;
    const format = pickFormatForNode(n);
    if (list) {
      assets.push({ id: n.id, name: n.name, format, dataBase64: "" });
    } else {
      assets.push(await exportNode(n, format));
    }
  }
  return assets;
}

async function collectAssets(
  root: SceneNode,
  opts: { list?: boolean } = {},
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
      const asset: WireAsset = opts.list
        ? { id: n.id, name: n.name, format, dataBase64: "" }
        : await exportNode(n, format);
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
      const ids: string[] | undefined = Array.isArray(req.ids) ? req.ids : undefined;

      if (ids && ids.length > 0) {
        const assets = await collectSpecific(ids, list);
        reply({ t: "assets", reqId: req.reqId, assets, error: null });
        return;
      }

      const node = await figma.getNodeByIdAsync(req.nodeId);
      if (!node || node.type === "PAGE" || node.type === "DOCUMENT") {
        reply({ t: "assets", reqId: req.reqId, assets: [], error: "node not found" });
        return;
      }
      const assets = await collectAssets(node as SceneNode, { list });
      reply({ t: "assets", reqId: req.reqId, assets, error: null });
    } catch (e) {
      reply({
        t: "assets",
        reqId: req.reqId,
        assets: [],
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }
}

/* ------------------------------------------------------------------ */
/* UI messages + startup                                               */
/* ------------------------------------------------------------------ */

figma.ui.onmessage = (message: { type?: string; req?: unknown }) => {
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
      void handleServerRequest(message.req);
      break;
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
