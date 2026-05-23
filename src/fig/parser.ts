/**
 * Offline .fig file ingest — the third Plumb data source.
 *
 * .fig is Figma's proprietary archive: a ZIP containing a `canvas.fig`
 * binary that holds two compressed chunks (a kiwi-schema definition +
 * a kiwi-encoded message). We don't reimplement the decoder — we lean on
 * `openfig-core`, the MIT-licensed parser maintained by the OpenFig
 * community (442 KB, 3 deps).
 *
 * This module wraps that primitive into a Plumb-shaped surface:
 *   - loadFig(path) → FigFile  (lazy node lookup, screen list)
 *   - figOutline(file) → { pages, screenCount }
 *   - figNodeById(file, id) → basic node metadata
 *
 * What the .fig path gives you:
 *   ✓ Headless / CI use (no Figma desktop required, no FIGMA_TOKEN)
 *   ✓ Reads any *saved* .fig you've exported from Figma
 *   ✗ No live selection, no auto-refresh on edits, no Variables
 *     beyond what's persisted in the file
 *
 * Use the plugin path when Figma is open; this is for everything else.
 */
import { readFileSync } from "node:fs";
import { parseFig, type FigDocument, type FigNode } from "openfig-core";

export interface FigFile {
  doc: FigDocument;
  /** Top-level frames across all pages — the agent's screen list. */
  screens: FigScreenEntry[];
  /** Pages keyed by id, each carrying its top-level frames. */
  pages: FigPageEntry[];
}

export interface FigScreenEntry {
  id: string;
  name: string;
  w: number;
  h: number;
  page: string;
}

export interface FigPageEntry {
  id: string;
  name: string;
  frames: FigScreenEntry[];
}

/** Load and parse a .fig file from disk. Throws on malformed input. */
export function loadFig(path: string): FigFile {
  const bytes = readFileSync(path);
  const doc = parseFig(bytes);
  return buildFigFile(doc);
}

/** Public for tests — build the screen/page index from an already-parsed doc. */
export function buildFigFile(doc: FigDocument): FigFile {
  const pages: FigPageEntry[] = [];
  const screens: FigScreenEntry[] = [];

  for (const node of doc.nodes) {
    if (node.type !== "CANVAS") continue;
    const pageId = nodeId(node);
    if (!pageId) continue;
    const pageName = node.name || "Untitled page";
    const children = doc.childrenMap.get(pageId) ?? [];
    const frames: FigScreenEntry[] = [];
    for (const child of children) {
      if (!isScreenLike(child)) continue;
      const childId = nodeId(child);
      if (!childId) continue;
      const entry: FigScreenEntry = {
        id: childId,
        name: child.name || childId,
        w: child.size ? Math.round(child.size.x) : 0,
        h: child.size ? Math.round(child.size.y) : 0,
        page: pageName,
      };
      frames.push(entry);
      screens.push(entry);
    }
    pages.push({ id: pageId, name: pageName, frames });
  }

  return { doc, screens, pages };
}

/** Resolve a node by its string id ("sessionID:localID"). */
export function figNodeById(file: FigFile, id: string): FigNode | null {
  return file.doc.nodeMap.get(id) ?? null;
}

const SCREEN_LIKE_TYPES = new Set(["FRAME", "COMPONENT", "INSTANCE"]);

function isScreenLike(node: FigNode): boolean {
  return SCREEN_LIKE_TYPES.has(node.type);
}

/** Stable id form used across openfig — `sessionID:localID`. */
function nodeId(node: FigNode): string | null {
  if (!node.guid) return null;
  return `${node.guid.sessionID}:${node.guid.localID}`;
}
