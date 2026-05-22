/// <reference types="@figma/plugin-typings" />

/**
 * Plumb plugin — main thread.
 *
 * Reads the current Figma selection, serializes it into the REST-shaped node
 * model the Plumb server already normalizes, and posts it to the UI iframe,
 * which relays it over the localhost WebSocket. Watches selection/document
 * changes so the spec stays live (plan §8 watch mode).
 */

const PLUGIN_VERSION = "0.0.1";

figma.showUI(__html__, { width: 264, height: 208, title: "Plumb" });

interface SerialNode {
  id: string;
  name: string;
  type: string;
  [key: string]: unknown;
}

const WEIGHTS: Record<string, number> = {
  thin: 100,
  hairline: 100,
  extralight: 200,
  ultralight: 200,
  light: 300,
  normal: 400,
  regular: 400,
  book: 400,
  medium: 500,
  semibold: 600,
  demibold: 600,
  bold: 700,
  extrabold: 800,
  ultrabold: 800,
  black: 900,
  heavy: 900,
};

function weightOf(styleName: string): number {
  const key = styleName.toLowerCase().replace(/\s+|italic|oblique/g, "");
  return WEIGHTS[key] ?? 400;
}

/** Serialize a Figma scene node into the REST-shaped model (src/figma/types). */
function serialize(node: SceneNode): SerialNode {
  // Figma's scene-graph properties are dynamic by nature; read them loosely.
  const n = node as unknown as Record<string, any>;
  const out: SerialNode = { id: node.id, name: node.name, type: node.type };

  if (n.visible === false) out.visible = false;

  const bb = n.absoluteBoundingBox;
  if (bb) {
    out.absoluteBoundingBox = { x: bb.x, y: bb.y, width: bb.width, height: bb.height };
  }

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
    if (typeof n.counterAxisSpacing === "number") {
      out.counterAxisSpacing = n.counterAxisSpacing;
    }
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
      // mainComponent access can throw on dynamic-page documents — skip
    }
  }

  if ("children" in node) {
    const kids = (node as ChildrenMixin).children;
    if (kids.length > 0) out.children = kids.map(serialize);
  }

  return out;
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

figma.on("selectionchange", pushSelection);

// Debounced watch mode — re-stream after the designer edits.
let changeTimer: ReturnType<typeof setTimeout> | null = null;
figma.on("documentchange", () => {
  if (changeTimer !== null) clearTimeout(changeTimer);
  changeTimer = setTimeout(pushSelection, 400);
});

figma.ui.onmessage = (message: { type?: string }) => {
  if (message && message.type === "resync") pushSelection();
};

pushSelection();
