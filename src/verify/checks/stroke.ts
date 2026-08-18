/** Border colour and width, and layer opacity. */

import { pushColorDelta } from "../color";
import { parsePx } from "../parse";
import type { CheckContext } from "./context";

export function checkStroke(c: CheckContext): void {
    // --- Stroke (border) ---------------------------------------------------
    if (c.node.stroke && c.node.stroke.startsWith("$c") && c.styles.borderColor) {
      pushColorDelta(c.node, "stroke", c.tokens.color[c.node.stroke], c.styles.borderColor, c.tol, c.deltas);
    }
    if (c.node.strokeW !== undefined && c.styles.borderWidth) {
      const v = parsePx(c.styles.borderWidth);
      if (v !== null) c.pushPx("stroke.width", c.node.strokeW, v);
    }

    // --- Opacity -----------------------------------------------------------
    if (typeof c.node.opacity === "number" && c.styles.opacity) {
      const v = parseFloat(c.styles.opacity);
      if (!Number.isNaN(v)) {
        const diff = Math.abs(c.node.opacity - v);
        if (diff > 0.05) {
          c.push("opacity", c.node.opacity, v, diff > 0.15 ? "error" : "warn");
        }
      }
    }
}
