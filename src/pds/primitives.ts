/**
 * The small shapes a PDS node is built out of: flow direction, resolved
 * auto-layout, repeat-group compression, and inline text runs.
 *
 * Nothing here depends on anything else in the PDS, which is what lets the
 * rest of the spec stack cleanly on top.
 */

export type Flow = "row" | "col" | "grid";

export interface PdsLayout {
  /** flex-direction — or `"grid"` for a CSS Grid container (web adapter
   *  only; Figma has no native Grid concept, so `normalize()` never
   *  produces this value). When `flow === "grid"`, `columns`/`rows` carry
   *  the grid-specific shape and `justify`/`align`/`wrap` don't apply. */
  flow: Flow;
  /** itemSpacing → gap (flex) — or grid column-gap when `flow === "grid"`. */
  gap?: number;
  /** counterAxisSpacing on a wrapping container (flex) — or grid row-gap
   *  when `flow === "grid"`. */
  gapCross?: number;
  /** [top, right, bottom, left] */
  pad: [number, number, number, number];
  /** justify-content, omitted when default (flex-start) */
  justify?: string;
  /** align-items, omitted when default (flex-start) */
  align?: string;
  /** flex-wrap */
  wrap?: boolean;
  /** `grid-template-columns` — only present when `flow === "grid"`. Web
   *  adapter only. This is the browser's COMPUTED value (resolved track
   *  sizes in px, e.g. `"384px 384px 384px"`), not the authored shorthand
   *  (`"repeat(3, 1fr)"`) — same "computed, not authored" convention every
   *  other captured style in this adapter already follows (padding, colors,
   *  etc.), and still faithful for a renderer at the captured viewport. */
  columns?: string;
  /** `grid-template-rows`, same computed-value convention as `columns` —
   *  only present when the site sets it explicitly (most real grids only
   *  constrain columns and let rows size to content, so this is often
   *  absent even on a real grid container). */
  rows?: string;
  /**
   * Main-axis content size: sum(children main-axis box) + (n-1)*gap.
   * Emitted only when `justify` is set AND the result is meaningfully
   * smaller than the container's main-axis box — i.e. the cases where a
   * renderer's naive "stack from start" assumption would mis-place items.
   * Compare to box.{w|h} minus matching `pad` ends to find the slack.
   */
  contentMain?: number;
}

/**
 * One repeating sibling cluster: a template el (kept fully in `nodes`) and a
 * per-instance delta map for every compressed sibling that follows it. The
 * compressed sibling els still appear in `parent.children` so the renderer
 * walks them in order; their entries are missing from `nodes` (intentional)
 * and the renderer hydrates them by reading the matching `data` entry.
 */
export interface PdsRepeatGroup {
  template: string;
  data: Record<
    string,
    Record<string, { chars?: string | PdsTextRun[]; assetId?: string; iconHint?: string }>
  >;
}

/**
 * A single styled run inside a TEXT node with mixed inline styles. The
 * dominant style still sits on the node (`text`, `fill`) so simple
 * renderers can ignore runs and ship the concatenated text correctly;
 * run-aware renderers compose `<span>`s with the per-run overrides.
 *
 * `s` and `c` are emitted only when the run diverges from the dominant.
 */
export interface PdsTextRun {
  /** Literal text for this run. */
  t: string;
  /** Type-style override — `$tN` ref into `tokens.text`. Omit if matches dominant. */
  s?: string;
  /** Colour override — `$cN` ref into `tokens.color`. Omit if matches dominant. */
  c?: string;
  /** "underline" / "line-through" override. Omit if matches dominant. */
  d?: "underline" | "line-through";
  /** `textCase` override — a differently-cased word/link within a run of
   *  otherwise-uncased text. Omit if matches the node's dominant `textCase`. */
  tc?: "UPPER" | "LOWER" | "TITLE";
}

/** A single colour stop inside a gradient fill. `at` is 0..1. */
