/// <reference types="@figma/plugin-typings" />

/**
 * Inventory — every screen in the file, and the live selection.
 *
 * Pushed to the server on load and on document change, so `plumb_outline` can
 * answer without a round trip and the agent always sees the current file.
 */

import { PLUGIN_VERSION } from "./constants";
import { serialize } from "./serialize";

/* ------------------------------------------------------------------ */
/* Inventory — every screen in the file                               */
/* ------------------------------------------------------------------ */

const SCREEN_TYPES = ["FRAME", "COMPONENT", "INSTANCE"];

export function frameEntry(n: any): { id: string; name: string; w: number; h: number } {
  const bb = n.absoluteBoundingBox;
  return {
    id: n.id,
    name: n.name,
    w: bb ? Math.round(bb.width) : 0,
    h: bb ? Math.round(bb.height) : 0,
  };
}

export function collectScreens(page: any): { id: string; name: string; w: number; h: number }[] {
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

export function pushInventory(): void {
  const pages = figma.root.children.map((page) => ({
    id: page.id,
    name: page.name,
    frames: collectScreens(page),
  }));
  figma.ui.postMessage({ type: "inventory", fileName: figma.root.name, pages });
}

export function pushSelection(): void {
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
