/**
 * Background fill, and the user-agent fallthrough that masquerades as one.
 *
 * A computed `backgroundColor` of `buttonface` or `field` is not a colour the
 * author chose — it means a reset is not taking and the browser is painting a
 * native control, which quietly breaks every dashboard built on `<button>`.
 */

import { isUserAgentColor, pushColorDelta } from "../color";
import type { CheckContext } from "./context";

export function checkFill(c: CheckContext): void {
    // --- Fill (background-color for non-text; text colour goes below) -------
    if (
      c.node.fill &&
      c.node.fill.startsWith("$c") &&
      c.node.type !== "text" &&
      c.styles.backgroundColor
    ) {
      pushColorDelta(
      c.node,
        "fill",
        c.tokens.color[c.node.fill],
        c.styles.backgroundColor,
        c.tol,
        c.deltas,
      );
    }

    // --- Form-control UA-style fallthrough (real-world bug #16) -------------
    // When rendered.backgroundColor parses to a UA keyword like `buttonface` or
    // `field`, the agent's reset CSS isn't taking and the browser is painting
    // the native control. This silently breaks dashboards built on <button>
    // elements with custom backgrounds. Surface it as a warn.
    if (c.styles.backgroundColor && isUserAgentColor(c.styles.backgroundColor)) {
      c.push("ua-style-fallthrough", "explicit background-color", c.styles.backgroundColor, "warn");
    }
}
