/**
 * Corner radius, including Figma's fully-rounded sentinel.
 *
 * `"full"` has no fixed pixel value — it means "at least half the shorter
 * side" — so a pill is checked against that threshold rather than a number,
 * and a rounded rectangle where the design has a pill is caught even though
 * both are "some radius".
 */

import { parsePx } from "../parse";
import type { CheckContext } from "./context";

export function checkRadius(c: CheckContext): void {
    // --- Border radius -----------------------------------------------------
    if (c.node.radius !== undefined && c.styles.borderRadius) {
      let expected: number | "full" | null = null;
      if (typeof c.node.radius === "string") expected = c.tokens.radius[c.node.radius] ?? null;
      else if (Array.isArray(c.node.radius)) expected = c.node.radius[0] ?? null;
      if (expected !== null) {
        const v = parsePx(c.styles.borderRadius);
        if (v !== null) {
          if (expected === "full") {
            const minSide = Math.min(c.node.box.w, c.node.box.h);
            // Anything >= half the smaller side is visually a pill/circle.
            if (minSide > 0 && v + c.tol.px.ok < minSide / 2) {
              c.push("radius", `full (>= ${Math.round((minSide / 2) * 100) / 100}px)`, v, v + c.tol.px.warn < minSide / 2 ? "error" : "warn");
            }
          } else {
            c.pushPx("radius", expected, v);
          }
        }
      }
    }
}
