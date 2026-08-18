/**
 * What every check needs, gathered once.
 *
 * The checks were one long function for a reason: they all read the same node,
 * the same computed styles, the same resolved token table and the same
 * tolerance config, and they all append to the same delta list. Splitting them
 * into modules only pays off if that shared state stays shared — passing six
 * arguments to fourteen functions would trade one long function for a worse
 * kind of noise.
 *
 * So this is the argument. Each check is `(c: CheckContext) => void`, reads
 * what it needs, and pushes what it found.
 */
import type { PdsNode, TokenTable } from "../../pds";
import type { Delta, RenderedElement, Severity, Tolerances } from "../types";

export interface CheckContext {
  node: PdsNode;
  /** The rendered element this node was matched to. */
  r: RenderedElement;
  /** `r.styles`, defaulted — every check reads it, none should re-default it. */
  styles: Record<string, string>;
  tokens: TokenTable;
  tol: Tolerances;
  /** Where findings go. Appended to, never replaced. */
  deltas: Delta[];
  /** Trimmed `chars` the design repeats ≥3×, i.e. template filler. */
  dupChars: Set<string>;

  /**
   * Record a numeric difference, if it exceeds tolerance. Defaults to
   * `tol.px`; text size passes a tighter band of its own.
   */
  pushPx(
    kind: string,
    expected: number,
    actual: number,
    custom?: { ok: number; warn: number },
  ): void;

  /** Record a finding that isn't a simple numeric diff. */
  push(kind: string, expected: Delta["expected"], actual: Delta["actual"], severity: Severity, diff?: number): void;
}

export function makeCheckContext(
  node: PdsNode,
  r: RenderedElement,
  tokens: TokenTable,
  tol: Tolerances,
  deltas: Delta[],
  dupChars: Set<string>,
): CheckContext {
  const push: CheckContext["push"] = (kind, expected, actual, severity, diff) => {
    const delta: Delta = { el: node.el, name: node.name, kind, expected, actual, severity };
    if (diff !== undefined) delta.diff = diff;
    deltas.push(delta);
  };

  return {
    node,
    r,
    styles: r.styles ?? {},
    tokens,
    tol,
    deltas,
    dupChars,
    push,
    pushPx(kind, expected, actual, custom) {
      const diff = Math.abs(expected - actual);
      const t = custom ?? tol.px;
      if (diff <= t.ok) return;
      push(kind, expected, actual, diff > t.warn ? "error" : "warn", diff);
    },
  };
}
