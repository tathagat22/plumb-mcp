/**
 * Coverage — the "did you build it at all?" half of verification.
 *
 * A build can have zero deltas and still be wrong, because a node nobody
 * tagged is a node nobody compared. This walks the PDS subtree the caller
 * asked about and reports what never showed up in the render, ranking the
 * nodes that carry real visual signal ahead of skeleton frames.
 */

import type { PdsDocument, PdsNode } from "../pds";
import type { CoverageInfo } from "./types";

/**
 * "Important" PDS nodes are the ones an agent usually wants to verify but
 * commonly forgets — anything with a visible fill, text, effect, image, or
 * radius. Skeleton frames without any of these are unlikely to surface bugs.
 */
export function isImportantNode(node: PdsNode): boolean {
  if (node.text || node.chars) return true;
  if (node.fill || node.fills) return true;
  if (node.effects || node.shadow || node.backdropFilter) return true;
  if (node.assetId) return true;
  if (node.radius !== undefined) return true;
  if (node.iconHint) return true;
  return false;
}

export function computeCoverage(pds: PdsDocument, matchedEls: Set<string>): CoverageInfo {
  // Collect every reachable PDS node under the requested root (skip orphans
  // that exist in the flat map but aren't in the requested subtree).
  const reachable = new Set<string>();
  const queue: string[] = [pds.root];
  while (queue.length) {
    const el = queue.shift();
    if (!el || reachable.has(el)) continue;
    reachable.add(el);
    const node = pds.nodes[el];
    if (node?.children) queue.push(...node.children);
  }
  const importantUntagged: string[] = [];
  const plainUntagged: string[] = [];
  let importantTotal = 0;
  let importantMatched = 0;
  for (const el of reachable) {
    const node = pds.nodes[el];
    if (!node) continue;
    const important = isImportantNode(node);
    if (important) importantTotal += 1;
    if (matchedEls.has(el)) {
      if (important) importantMatched += 1;
      continue;
    }
    if (important) importantUntagged.push(el);
    else plainUntagged.push(el);
  }
  // Cap the surfaced list — agents don't need 200 names, the top ~20 is plenty
  // to identify what to add to the next round of tagging.
  const untagged = importantUntagged
    .concat(plainUntagged)
    .slice(0, 20);
  const pdsTotal = reachable.size;
  const coverage = pdsTotal === 0 ? 1 : matchedEls.size / pdsTotal;
  return {
    pdsTotal,
    matched: matchedEls.size,
    coverage: Math.round(coverage * 100) / 100,
    untagged,
    importantTotal,
    importantMatched,
  };
}
