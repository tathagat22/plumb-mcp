/**
 * Size and auto-layout.
 *
 * The interesting part is what is deliberately NOT checked: an axis the
 * compiler could only estimate. A `fill`/`hug` child or a text node with
 * content-driven auto-resize gets its real size from Figma's layout engine, so
 * a delta against the authored estimate is noise dressed up as a defect.
 */

import { resolveLayout } from "../../normalize/resolve";
import { parsePx } from "../parse";
import type { CheckContext } from "./context";

export function checkGeometry(c: CheckContext): void {
    // --- Size ----------------------------------------------------------------
    // Skip axes the compiler can only ESTIMATE: fill/hug auto-layout children and
    // text with content-driven auto-resize get their real size from Figma's layout
    // engine, so a delta vs the authored estimate is noise, not a defect.
    const wEstimate =
      c.node.sizing?.w === "fill" ||
      c.node.sizing?.w === "hug" ||
      (c.node.type === "text" && c.node.textGrow === "wh");
    const hEstimate =
      c.node.sizing?.h === "fill" ||
      c.node.sizing?.h === "hug" ||
      (c.node.type === "text" && (c.node.textGrow === "h" || c.node.textGrow === "wh"));
    if (c.node.box.w > 0 && c.r.box.w > 0 && !wEstimate) c.pushPx("size.w", c.node.box.w, c.r.box.w);
    if (c.node.box.h > 0 && c.r.box.h > 0 && !hEstimate) c.pushPx("size.h", c.node.box.h, c.r.box.h);

    // --- Layout (only if PDS describes one) ---------------------------------
    // Layout may arrive as a `$lN` ref into c.tokens.layout (v0.10+) — resolve
    // once and use the literal everywhere below.
    const layout = resolveLayout(c.node.layout, c.tokens);
    if (layout) {
      const pdsFlow = layout.flow === "col" ? "column" : "row";
      const renFlow = c.styles.flexDirection;
      if (renFlow && renFlow !== pdsFlow) {
        c.push("layout.flow", pdsFlow, renFlow, "error");
      }
      if (layout.gap !== undefined) {
        const v = parsePx(c.styles.gap);
        if (v !== null) c.pushPx("layout.gap", layout.gap, v);
      }
      const pad = layout.pad;
      const sideMap: Array<[string, number, number | null]> = [
        ["pad.top", pad[0], parsePx(c.styles.paddingTop)],
        ["pad.right", pad[1], parsePx(c.styles.paddingRight)],
        ["pad.bottom", pad[2], parsePx(c.styles.paddingBottom)],
        ["pad.left", pad[3], parsePx(c.styles.paddingLeft)],
      ];
      for (const [kind, expected, actual] of sideMap) {
        if (actual !== null) c.pushPx(kind, expected, actual);
      }
      if (layout.justify) {
        const v = c.styles.justifyContent;
        if (v && v !== layout.justify) {
          c.push("layout.justify", layout.justify, v, "warn");
        }
      }
      if (layout.align) {
        const v = c.styles.alignItems;
        if (v && v !== layout.align) {
          c.push("layout.align", layout.align, v, "warn");
        }
      }
    }
}
