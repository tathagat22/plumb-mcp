/**
 * The plan's asset manifest: every image and inline SVG the nodes reference,
 * deduped, with the dimensions the executor needs to size them.
 */

import type { EmitAsset } from "../../bridge/protocol";
import { type LowerOptions } from "./types";

/* ------------------------------------------------------------------------ */
/* Assets                                                                     */
/* ------------------------------------------------------------------------ */

export function buildAssets(
  refs: Set<string>,
  info: LowerOptions["assets"],
): EmitAsset[] {
  if (!info) return [];
  const out: EmitAsset[] = [];
  for (const ref of refs) {
    const a = info[ref];
    if (!a) continue;
    const asset: EmitAsset = { ref, ext: a.ext, kind: a.kind };
    if (a.svgInline) asset.svgInline = a.svgInline;
    if (a.w !== undefined) asset.w = a.w;
    if (a.h !== undefined) asset.h = a.h;
    out.push(asset);
  }
  return out;
}
