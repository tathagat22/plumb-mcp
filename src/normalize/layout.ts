import { cleanPx } from "../util/num";
import type { FigmaNode } from "../figma/types";
import type { Flow, PdsLayout } from "../pds";

/**
 * Auto-layout → flexbox. The single source of truth is plan Appendix A; this
 * implements the "Layout" rows of that table. Default values (MIN alignment)
 * are dropped so the agent writes `flex` directly without noise.
 */

const JUSTIFY: Record<string, string> = {
  MIN: "flex-start",
  CENTER: "center",
  MAX: "flex-end",
  SPACE_BETWEEN: "space-between",
};

const ALIGN: Record<string, string> = {
  MIN: "flex-start",
  CENTER: "center",
  MAX: "flex-end",
  BASELINE: "baseline",
};

export function toLayout(n: FigmaNode): PdsLayout | undefined {
  if (!n.layoutMode || n.layoutMode === "NONE") return undefined;

  const flow: Flow = n.layoutMode === "VERTICAL" ? "col" : "row";
  const layout: PdsLayout = {
    flow,
    pad: [
      cleanPx(n.paddingTop ?? 0),
      cleanPx(n.paddingRight ?? 0),
      cleanPx(n.paddingBottom ?? 0),
      cleanPx(n.paddingLeft ?? 0),
    ],
  };

  if (n.itemSpacing) {
    const gap = cleanPx(n.itemSpacing);
    if (gap) layout.gap = gap;
  }

  if (n.layoutWrap === "WRAP") {
    layout.wrap = true;
    if (n.counterAxisSpacing) {
      const gapCross = cleanPx(n.counterAxisSpacing);
      if (gapCross) layout.gapCross = gapCross;
    }
  }

  // Drop MIN (the flex default) to keep the spec terse.
  const primary = n.primaryAxisAlignItems;
  if (primary && primary !== "MIN" && JUSTIFY[primary]) {
    layout.justify = JUSTIFY[primary];
  }
  const counter = n.counterAxisAlignItems;
  if (counter && counter !== "MIN" && ALIGN[counter]) {
    layout.align = ALIGN[counter];
  }

  return layout;
}
