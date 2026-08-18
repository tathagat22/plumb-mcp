/**
 * plumb_verify's comparison engine (plan §8).
 *
 * Pure: given a PDS and the agent's rendered layout, produce a sorted list of
 * structured deltas (no CV, no pixel diff). Every comparison is tolerance-aware
 * and edge-case-careful.
 *
 * This file is the entry point and the public surface; the engine is split by
 * concern under `verify/`:
 *
 *   types.ts     the shapes going in and coming out
 *   parse.ts     computed-style strings → numbers, or null
 *   color.ts     ΔE2000 distance, and the user-agent-colour fallthrough check
 *   text.ts      content vs. fidelity — which strings are placeholder filler
 *   coverage.ts  what the build never tagged at all
 *   compare.ts   every typed check, for one node
 *
 * Import from here. The modules import from each other.
 */
import { compareOne, type CompareContext } from "./verify/compare";
import { computeCoverage } from "./verify/coverage";
import { collectDuplicateChars } from "./verify/text";
import type { PdsDocument, PdsNode } from "./pds";
import {
  DEFAULT_TOLERANCES,
  type Delta,
  type RenderedElement,
  type Severity,
  type Tolerances,
  type VerifyResult,
} from "./verify/types";

export type {
  CoverageInfo,
  Delta,
  RenderedElement,
  Severity,
  Tolerances,
  VerifyResult,
} from "./verify/types";
export { DEFAULT_TOLERANCES } from "./verify/types";
export { parseColor } from "./verify/color";
export { parsePx, parseTextToken } from "./verify/parse";
export { isPlaceholderText } from "./verify/text";

const MAX_DELTAS = 150;

/** Run the full comparison. Always returns a result — no throws. */
export function verifyAgainst(
  pds: PdsDocument,
  rendered: RenderedElement[],
  tolerances: Tolerances = DEFAULT_TOLERANCES,
): VerifyResult {
  // The rendered set's keys can be either the short `el` handle or the
  // globally-unique dotted `path`; build both lookup tables so agents that
  // tagged deep-nested DOM with `path` aren't punished. PDS keys are `el`s, so
  // we index `pds.nodes` by both surfaces here.
  const byEl = new Map<string, PdsNode>();
  const byPath = new Map<string, PdsNode>();
  for (const el of Object.keys(pds.nodes)) {
    const node = pds.nodes[el];
    if (!node) continue;
    byEl.set(el, node);
    if (node.path) byPath.set(node.path, node);
  }

  // Content-awareness pass: designers copy-paste the *same* placeholder string
  // across many cells/rows purely to mock the layout — the real build drops
  // entirely different content into those slots. A string the design repeats ≥3
  // times is template filler, so a content swap there must not be flagged as a
  // fidelity miss (style on those nodes is still checked at full strictness).
  const dupChars = collectDuplicateChars(pds);
  const ctx: CompareContext = { dupChars };

  const deltas: Delta[] = [];
  let matched = 0;
  let unmatched = 0;
  const matchedEls = new Set<string>();

  for (const r of rendered) {
    if (deltas.length >= MAX_DELTAS) break;
    const node = byEl.get(r.el) ?? byPath.get(r.el);
    if (!node) {
      unmatched += 1;
      deltas.push({
        el: r.el,
        name: r.el,
        kind: "missing-in-pds",
        expected: null,
        actual: r.el,
        severity: "warn",
      });
      continue;
    }
    matched += 1;
    matchedEls.add(node.el);
    compareOne(node, r, pds.tokens, tolerances, deltas, ctx);
  }

  // Coverage: the verifier's most useful affordance, per real-world feedback.
  // "All 10 matched / 0 deltas" lies if the screen had 47 tag-worthy nodes
  // and you only checked the skeleton. Compute and surface the gap so the
  // agent knows what to tag on the next round.
  const coverage = computeCoverage(pds, matchedEls);

  deltas.sort(
    (a, b) =>
      severityRank(a.severity) - severityRank(b.severity) ||
      (b.diff ?? 0) - (a.diff ?? 0),
  );

  const truncated = deltas.length > MAX_DELTAS;
  if (truncated) deltas.length = MAX_DELTAS;

  const ok = deltas.every((d) => d.severity !== "error");
  const base: VerifyResult = {
    matched,
    rendered: rendered.length,
    unmatched,
    ok,
    deltas,
    coverage,
  };
  if (truncated) base.truncated = true;
  return base;
}

function severityRank(s: Severity): number {
  return s === "error" ? 0 : s === "warn" ? 1 : 2;
}
