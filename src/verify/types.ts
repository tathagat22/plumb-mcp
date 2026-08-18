/**
 * The vocabulary `plumb_verify` speaks: what a rendered build looks like going
 * in, and what a scored comparison looks like coming out.
 *
 * Deliberately logic-free, so the comparison modules, the fit scorer, and
 * every downstream caller can import these shapes without pulling in the
 * engine that produces them.
 */


export interface RenderedElement {
  el: string;
  box: { x: number; y: number; w: number; h: number };
  text?: string;
  styles?: Record<string, string>;
  /** `data-plumb-asset` value — the exported asset id this element rendered. */
  asset?: string;
  /** Whether the element rendered real image/vector content (vs. a redrawn div). */
  img?: boolean;
}

export interface Tolerances {
  px: { ok: number; warn: number };
  color: { ok: number; warn: number };
}

export const DEFAULT_TOLERANCES: Tolerances = {
  px: { ok: 1, warn: 3 },
  // v0.10 Phase 6 — colour distance is ΔE2000 (perceptually uniform). Thresholds:
  //   ≤ ok (1.0) → just-noticeable, never flag
  //   ≤ warn (3.5) → clearly different but plausibly within an agent's tolerance
  //   > warn → likely a real mismatch
  // Previously this was sum-of-abs-RGB-channel-deltas (ok=6, warn=24); the new
  // numbers are smaller because ΔE2000 is a different scale.
  color: { ok: 1, warn: 3.5 },
};

export type Severity = "error" | "warn" | "info";

export interface Delta {
  el: string;
  /** Mirrors PdsNode.name — undefined when Figma's name was auto-generated. */
  name?: string;
  kind: string;
  expected: string | number | null;
  actual: string | number | null;
  diff?: number;
  severity: Severity;
}

export interface CoverageInfo {
  pdsTotal: number;
  matched: number;
  coverage: number; // 0..1 ratio
  /**
   * `el`s present in the PDS subtree but NOT in `rendered`. Prioritised so
   * "important" untagged nodes (fills, text, effects, interactive surfaces)
   * float to the top — these are usually the ones an agent forgot to tag.
   */
  untagged: string[];
  /**
   * Count of reachable nodes that carry real visual signal (text, fill,
   * effect, image, radius, icon — see {@link isImportantNode}). Skeleton
   * frames are excluded. The denominator the fit score uses so "I built
   * every node that matters" can reach 100% without tagging spacer frames.
   */
  importantTotal: number;
  /** How many of those important nodes were actually tagged/built. */
  importantMatched: number;
}

export interface VerifyResult {
  matched: number;
  rendered: number;
  unmatched: number;
  ok: boolean;
  deltas: Delta[];
  truncated?: boolean;
  coverage?: CoverageInfo;
}
