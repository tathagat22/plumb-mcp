/**
 * Best-effort flexbox sizing for the DSL compiler.
 *
 * PDS carries a concrete `box: {w,h}` on every node, but the authoring DSL
 * speaks in intent (`hug` / `fill` / px / `%`). This module derives a
 * plausible box so the emitted PDS reads sensibly and verify has numbers to
 * diff against — Figma auto-layout re-solves the exact geometry on emit
 * (driven by the `sizing` / `grow` intent we also emit), so these numbers are
 * a starting estimate, not the final truth.
 *
 * Strategy: width flows DOWN (a page width is known, sections fill it, their
 * children fill or hug), height is measured UP from content. Text boxes come
 * from the injected `TextMeasurer` when present, else a documented estimator.
 */

import { round } from "../util/num";
import type { Flow, PdsLayout } from "../pds";
import type {
  Align,
  Justify,
  ResolvedTypeStyle,
  SelfAlign,
  Size,
  TextMeasurer,
} from "./schema";

export interface Box {
  w: number;
  h: number;
}

/** DSL Justify → the CSS string PDS layout stores (matches normalize/layout). */
const JUSTIFY: Record<Justify, string> = {
  start: "flex-start",
  center: "center",
  end: "flex-end",
  between: "space-between",
};

const ALIGN: Record<Align, string> = {
  start: "flex-start",
  center: "center",
  end: "flex-end",
  stretch: "stretch",
  baseline: "baseline",
};

const SELF: Record<SelfAlign, "stretch" | "min" | "center" | "max"> = {
  start: "min",
  center: "center",
  end: "max",
  stretch: "stretch",
};

/** Map, dropping the flex default (`flex-start`) to keep the spec terse. */
export function mapJustify(j: Justify | undefined): string | undefined {
  if (j === undefined) return undefined;
  const v = JUSTIFY[j];
  return v === "flex-start" ? undefined : v;
}

export function mapAlign(a: Align | undefined): string | undefined {
  if (a === undefined) return undefined;
  const v = ALIGN[a];
  return v === "flex-start" ? undefined : v;
}

export function mapSelf(s: SelfAlign | undefined): "stretch" | "min" | "center" | "max" | undefined {
  return s === undefined ? undefined : SELF[s];
}

/**
 * Resolve the concrete pixel width for a block given the width available from
 * its parent. Returns `undefined` for `hug` / unspecified — the caller then
 * measures content instead.
 */
export function resolveWidth(w: Size | undefined, avail: number): number | undefined {
  if (w === undefined || w === "hug") return undefined;
  if (w === "fill") return avail;
  if (typeof w === "number") return w;
  const pct = parsePercent(w);
  if (pct !== undefined) return round((avail * pct) / 100, 2);
  return undefined;
}

/** Same as resolveWidth but for a fixed height (percent needs a parent height). */
export function resolveHeight(h: Size | undefined, avail?: number): number | undefined {
  if (h === undefined || h === "hug" || h === "fill") return undefined;
  if (typeof h === "number") return h;
  const pct = parsePercent(h);
  if (pct !== undefined && avail !== undefined) return round((avail * pct) / 100, 2);
  return undefined;
}

function parsePercent(s: string): number | undefined {
  const m = /^(\d+(?:\.\d+)?)%$/.exec(s.trim());
  return m ? Number(m[1]) : undefined;
}

/** The auto-layout `sizing` intent (fill/hug/fixed) for a child's own w/h.
 *  A NUMERIC size becomes `"fixed"` so an auto-layout frame HOLDS that pixel
 *  size — without it, Figma auto-layout frames default to AUTO (hug) and snap
 *  back to their content after `resize()`, collapsing e.g. a 64×64 icon chip
 *  down to the 30px icon inside it. */
export function sizingFor(
  w: Size | undefined,
  h: Size | undefined,
): { w?: "fill" | "hug" | "fixed"; h?: "fill" | "hug" | "fixed" } | undefined {
  const out: { w?: "fill" | "hug" | "fixed"; h?: "fill" | "hug" | "fixed" } = {};
  if (w === "fill") out.w = "fill";
  else if (w === "hug") out.w = "hug";
  else if (typeof w === "number") out.w = "fixed";
  if (h === "fill") out.h = "fill";
  else if (h === "hug") out.h = "hug";
  else if (typeof h === "number") out.h = "fixed";
  return out.w || out.h ? out : undefined;
}

/**
 * Container box from its children boxes + auto-layout config. `pad` is PDS
 * `[t,r,b,l]`. Used for `hug` containers; a `fill`/fixed container overrides
 * the relevant axis with the known value.
 */
export function measureContainer(
  flow: Flow,
  gap: number,
  pad: [number, number, number, number],
  children: Box[],
): Box {
  const [t, r, b, l] = pad;
  const n = children.length;
  const gaps = n > 1 ? gap * (n - 1) : 0;
  if (flow === "row") {
    const inner = children.reduce((s, c) => s + c.w, 0) + gaps;
    const cross = children.reduce((m, c) => Math.max(m, c.h), 0);
    return { w: round(inner + l + r, 2), h: round(cross + t + b, 2) };
  }
  const inner = children.reduce((s, c) => s + c.h, 0) + gaps;
  const cross = children.reduce((m, c) => Math.max(m, c.w), 0);
  return { w: round(cross + l + r, 2), h: round(inner + t + b, 2) };
}

/**
 * Text box estimate. Uses the injected measurer when present, else a
 * character-width heuristic (~0.52em average glyph advance) — good enough for
 * a first-pass box that Figma's TEXT auto-resize then finalizes.
 */
export function measureText(
  chars: string,
  rts: ResolvedTypeStyle,
  maxWidth: number | undefined,
  measurer: TextMeasurer | undefined,
): Box {
  if (measurer) {
    const m = measurer.measure(chars, rts, maxWidth);
    return { w: round(m.w, 2), h: round(m.h, 2) };
  }
  const lineH = rts.size * rts.line;
  const avg = rts.size * 0.52 + rts.tracking;
  const oneLine = Math.max(chars.length, 1) * avg;
  if (maxWidth !== undefined && oneLine > maxWidth) {
    const lines = Math.max(1, Math.ceil(oneLine / maxWidth));
    return { w: round(maxWidth, 2), h: round(lines * lineH, 2) };
  }
  return { w: round(oneLine, 2), h: round(lineH, 2) };
}

/** Build the PDS layout object for a stack (before interning). */
export function buildLayout(
  flow: Flow,
  opts: {
    gap?: number;
    gapCross?: number;
    pad: [number, number, number, number];
    justify?: Justify;
    align?: Align;
    wrap?: boolean;
  },
): PdsLayout {
  const layout: PdsLayout = { flow, pad: opts.pad };
  if (opts.gap) layout.gap = opts.gap;
  if (opts.wrap) {
    layout.wrap = true;
    if (opts.gapCross) layout.gapCross = opts.gapCross;
  }
  const j = mapJustify(opts.justify);
  if (j) layout.justify = j;
  const a = mapAlign(opts.align);
  if (a) layout.align = a;
  return layout;
}
