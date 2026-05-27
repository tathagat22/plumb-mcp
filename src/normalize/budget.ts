import { buildPreWalk, normalize } from "./normalize";
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
 * only a re-walk, never another fetch. The depth-independent el/handle map is
 * built once and shared across iterations, so even the re-walk cost is just
 * the per-depth emit pass, not the full preWalk-plus-emit.
 */
export function normalizeToBudget(
  file: FigmaFileResult,
  depth: number,
  maxTokens: number | undefined,
  opts: NormalizeOptions = {},
): PdsDocument {
  // Build the depth-independent el/handle map exactly once — every depth-step
  // iteration shares the same handles, so re-running this on each retry was
  // pure overhead (audit-flagged for v0.10 Phase 0).
  const precomputed = buildPreWalk(file);
  const baseOpts = { ...opts, precomputed };

  let pds = normalize(file, depth, baseOpts);
  if (!maxTokens) return pds;

  let depthUsed = depth;
  while (pds.meta.estTokens > maxTokens && depthUsed > 0) {
    depthUsed -= 1;
    pds = normalize(file, depthUsed, baseOpts);
  }
  if (pds.meta.estTokens > maxTokens) {
    // Even depth 0 overflows — keep it, but flag the truncation.
    pds = normalize(file, depthUsed, { ...baseOpts, maxTokens });
  }
  return pds;
}
