import { normalize } from "./normalize";
import type { NormalizeOptions } from "./normalize";
import type { FigmaFileResult } from "../figma/types";
import type { PdsDocument } from "../pds";

/**
 * Normalize a fetched subtree to fit a token budget (plan §6.4). Starts at
 * `depth` and steps the disclosure depth down until the PDS fits `maxTokens`
 * (or depth reaches 0, in which case the result is flagged `truncated`).
 * With no `maxTokens`, this is a plain normalize at `depth`.
 *
 * Pure and synchronous — the fetched tree is reused, so stepping down costs
 * only a re-walk, never another fetch.
 */
export function normalizeToBudget(
  file: FigmaFileResult,
  depth: number,
  maxTokens: number | undefined,
  opts: NormalizeOptions = {},
): PdsDocument {
  let pds = normalize(file, depth, opts);
  if (!maxTokens) return pds;

  let depthUsed = depth;
  while (pds.meta.estTokens > maxTokens && depthUsed > 0) {
    depthUsed -= 1;
    pds = normalize(file, depthUsed, opts);
  }
  if (pds.meta.estTokens > maxTokens) {
    // Even depth 0 overflows — keep it, but flag the truncation.
    pds = normalize(file, depthUsed, { ...opts, maxTokens });
  }
  return pds;
}
