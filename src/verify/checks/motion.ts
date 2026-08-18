/**
 * Rotation and flex-child sizing.
 *
 * `grow` and `align-self` misses are the number one "almost right" layout bug
 * on real screens: everything is present, everything is the right colour, and
 * one element refuses to stretch.
 */

import { parseRotation, round } from "../parse";
import type { CheckContext } from "./context";

export function checkFlex(c: CheckContext): void {
    // Rotation: parse `transform: rotate(Ndeg)` or a 2D matrix. Allow ±0.5°
    // slack so subpixel rounding doesn't fire.
    if (typeof c.node.rotation === "number" && Math.abs(c.node.rotation) > 0.5) {
      const renderedDeg = parseRotation(c.styles.transform);
      if (renderedDeg !== null) {
        const diff = Math.abs(c.node.rotation - renderedDeg);
        if (diff > 1) {
          c.push("rotation", round(c.node.rotation, 2), round(renderedDeg, 2), diff > 5 ? "error" : "warn");
        }
      }
    }

    // Flex-child sizing — grow + align-self. Misses here are the #1
    // "almost right" layout bug from real screens.
    if (typeof c.node.grow === "number" && c.node.grow > 0 && c.styles.flexGrow) {
      const v = parseFloat(c.styles.flexGrow);
      if (!Number.isNaN(v) && Math.abs(v - c.node.grow) > 0.01) {
        c.push("flex.grow", c.node.grow, v, "warn", Math.abs(v - c.node.grow));
      }
    }
    if (c.node.selfAlign && c.styles.alignSelf && c.styles.alignSelf !== "auto") {
      const cssAlign =
        c.node.selfAlign === "stretch"
          ? "stretch"
          : c.node.selfAlign === "min"
            ? "flex-start"
            : c.node.selfAlign === "max"
              ? "flex-end"
              : c.node.selfAlign === "center"
                ? "center"
                : undefined;
      if (cssAlign && cssAlign !== c.styles.alignSelf) {
        c.push("flex.selfAlign", cssAlign, c.styles.alignSelf, "warn");
      }
    }
}
