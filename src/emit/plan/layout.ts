/**
 * Auto-layout, PDS shape to Figma's.
 *
 * The two describe the same thing with different words: CSS flexbox names
 * (`justify-content`, `align-items`) against Figma's primary/counter axis
 * pair, which additionally swaps meaning depending on the layout direction.
 */

import type { EmitChildLayout, EmitLayout } from "../../bridge/protocol";
import type { PdsLayout, PdsNode, TokenTable } from "../../pds";

/* ------------------------------------------------------------------------ */
/* Layout                                                                     */
/* ------------------------------------------------------------------------ */

export function resolveLayout(
  layout: PdsLayout | string | undefined,
  tokens: TokenTable,
): PdsLayout | undefined {
  if (layout === undefined) return undefined;
  if (typeof layout === "string") return tokens.layout?.[layout];
  return layout;
}

const JUSTIFY_TO_PRIMARY: Record<string, NonNullable<EmitLayout["primary"]>> = {
  "flex-start": "MIN",
  center: "CENTER",
  "flex-end": "MAX",
  "space-between": "SPACE_BETWEEN",
};

const ALIGN_TO_COUNTER: Record<string, NonNullable<EmitLayout["counter"]>> = {
  "flex-start": "MIN",
  center: "CENTER",
  "flex-end": "MAX",
  baseline: "BASELINE",
};

export function toEmitLayout(l: PdsLayout): EmitLayout {
  const [t, r, b, left] = l.pad;
  const out: EmitLayout = {
    mode: l.flow === "row" ? "HORIZONTAL" : "VERTICAL",
    pad: { t, r, b, l: left },
  };
  if (l.gap !== undefined) out.gap = l.gap;
  if (l.gapCross !== undefined) out.gapCross = l.gapCross;
  if (l.justify && JUSTIFY_TO_PRIMARY[l.justify]) out.primary = JUSTIFY_TO_PRIMARY[l.justify];
  if (l.align && ALIGN_TO_COUNTER[l.align]) out.counter = ALIGN_TO_COUNTER[l.align];
  if (l.wrap) out.wrap = true;
  return out;
}

const SELF_TO_ALIGN: Record<string, NonNullable<EmitChildLayout["align"]>> = {
  stretch: "STRETCH",
  min: "MIN",
  center: "CENTER",
  max: "MAX",
};

export function toChildLayout(node: PdsNode): EmitChildLayout | undefined {
  const out: EmitChildLayout = {};
  let set = false;
  if (node.grow) {
    out.grow = node.grow;
    set = true;
  }
  if (node.selfAlign && SELF_TO_ALIGN[node.selfAlign]) {
    out.align = SELF_TO_ALIGN[node.selfAlign];
    set = true;
  }
  if (node.sizing?.w) {
    out.sizingH = node.sizing.w === "fill" ? "FILL" : node.sizing.w === "fixed" ? "FIXED" : "HUG";
    set = true;
  }
  if (node.sizing?.h) {
    out.sizingV = node.sizing.h === "fill" ? "FILL" : node.sizing.h === "fixed" ? "FIXED" : "HUG";
    set = true;
  }
  return set ? out : undefined;
}
