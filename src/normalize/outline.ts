import { estimateTokens } from "../util/estimate";
import { round } from "../util/num";
import { HandleMinter } from "./handles";
import type { FigmaNode } from "../figma/types";

export interface OutlineFrame {
  id: string;
  el: string;
  name: string;
  type: string;
  box: { w: number; h: number };
}

export interface OutlinePage {
  id: string;
  name: string;
  frames: OutlineFrame[];
}

export interface OutlineDocument {
  file: { key: string; name: string; version: string };
  pages: OutlinePage[];
  meta: { pageCount: number; frameCount: number; estTokens: number };
  next: string;
}

/**
 * Build the shallow file map for `plumb_outline`: pages (CANVAS nodes) and
 * their top-level frames. No token interning, no deep recursion — this is the
 * cheap entry point an agent calls before drilling in with `plumb_node`.
 */
export function buildOutline(
  document: FigmaNode,
  file: { key: string; name: string; version: string },
): OutlineDocument {
  const minter = new HandleMinter();
  const pages: OutlinePage[] = [];

  for (const page of document.children ?? []) {
    if (page.visible === false) continue;
    const frames: OutlineFrame[] = [];
    for (const frame of page.children ?? []) {
      if (frame.visible === false) continue;
      frames.push({
        id: frame.id,
        el: minter.mint(frame.name ?? "", frame.type ?? ""),
        name: frame.name ?? "",
        type: (frame.type ?? "").toLowerCase(),
        box: {
          w: round(frame.absoluteBoundingBox?.width ?? 0),
          h: round(frame.absoluteBoundingBox?.height ?? 0),
        },
      });
    }
    pages.push({ id: page.id, name: page.name ?? "", frames });
  }

  const frameCount = pages.reduce((n, p) => n + p.frames.length, 0);
  const outline: OutlineDocument = {
    file,
    pages,
    meta: { pageCount: pages.length, frameCount, estTokens: 0 },
    next:
      "Pick a frame, then call plumb_node with this fileKey and the frame's " +
      "`id` at depth 2-3. Drill into any node that has a `more` count.",
  };
  outline.meta.estTokens = estimateTokens(JSON.stringify(outline));
  return outline;
}
