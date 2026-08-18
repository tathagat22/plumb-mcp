/**
 * Fill-stack depth.
 *
 * When the PDS says a surface has three layered fills and the render has a
 * flat `background-color`, the gradient or overlay was dropped. Counting
 * layers catches that without needing to compare the layers themselves.
 */

import type { TokenTable } from "../../pds";
import type { CheckContext } from "./context";

export function checkFillStack(c: CheckContext): void {
    // Fill-stack count — when PDS says "this surface has 3 layered fills"
    // a flat `background-color` rendered alone is a clear miss. Resolve the
    // fills ref (may be a $fN token) before counting.
    const fillsValue =
      typeof c.node.fills === "string"
        ? (c.tokens as TokenTable).fills?.[c.node.fills]
        : c.node.fills;
    if (Array.isArray(fillsValue) && fillsValue.length > 1) {
      const bg = c.styles.backgroundImage ?? "";
      // Count comma-separated layers in background-image. A single solid
      // colour shows up as just `background-color` with no `background-image`.
      const layers = bg && bg !== "none" ? bg.split(/,\s*(?![^()]*\))/).length : 0;
      if (layers < fillsValue.length) {
        c.push("fills.count", fillsValue.length, layers, "warn", fillsValue.length - layers);
      }
    }
}
