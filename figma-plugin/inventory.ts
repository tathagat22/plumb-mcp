/// <reference types="@figma/plugin-typings" />

/**
 * Inventory — every screen in the file, and the live selection.
 *
 * Pushed to the server on load and on document change, so `plumb_outline` can
 * answer without a round trip and the agent always sees the current file.
 */

import { PLUGIN_VERSION } from "./constants";

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

/* ------------------------------------------------------------------ */
/* Page loading — only what's needed                                   */
/* ------------------------------------------------------------------ */

/**
 * Under `documentAccess: "dynamic-page"` a page's children can't be read until
 * the page is loaded, and loading every page up front is what Figma warns can
 * hit the memory limit on large files. So the plugin starts with just the page
 * you're on, and loads the rest only when a request needs the whole file
 * (outline by name, search, components).
 */
let allPagesLoaded = false;
let loadingAll: Promise<void> | null = null;

/** Load every page, once. Concurrent callers share the same load. */
export function ensureAllPagesLoaded(): Promise<void> {
  if (allPagesLoaded) return Promise.resolve();
  if (!loadingAll) {
    loadingAll = figma.loadAllPagesAsync().then(
      () => {
        allPagesLoaded = true;
      },
      (e) => {
        loadingAll = null; // let a later request retry
        throw e;
      },
    );
  }
  return loadingAll;
}

/**
 * Pages Plumb has loaded carry their screens. The rest are listed with
 * `loaded: false` and no frames; the server asks for the full inventory
 * (`get-inventory`) only when a tool actually needs it.
 */
export function buildInventory(): {
  fileName: string;
  pages: { id: string; name: string; frames: ReturnType<typeof collectScreens>; loaded?: false }[];
} {
  const pages = figma.root.children.map((page) => {
    try {
      // Throws for a page that isn't loaded — which is exactly the check we
      // want, and it also picks up pages Figma loaded for us (the ones you've
      // visited, or that a get-node by id pulled in).
      return { id: page.id, name: page.name, frames: collectScreens(page) };
    } catch {
      return { id: page.id, name: page.name, frames: [], loaded: false as const };
    }
  });
  return { fileName: figma.root.name, pages };
}

export function pushInventory(): void {
  figma.ui.postMessage({ type: "inventory", ...buildInventory() });
}

export function pushSelection(): void {
  const selection = figma.currentPage.selection;
  const node = selection.length > 0 ? selection[0] : null;
  figma.ui.postMessage({
    type: "selection",
    nodeId: node ? node.id : null,
    fileName: figma.root.name,
    pageName: figma.currentPage.name,
    nodeName: node ? node.name : null,
    pluginVersion: PLUGIN_VERSION,
  });
}
