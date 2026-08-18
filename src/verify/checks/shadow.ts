/**
 * Elevation: box-shadow and backdrop-filter.
 *
 * Neither is byte-compared — small colour and blur rounding shouldn't flag —
 * but both are checked for presence, because dropping them entirely is the
 * single most common way a build comes out flat. A 2px blur where the design
 * has a 24px soft drop is the kind of detail that quietly cheapens a screen.
 */

import { parseBlurRadius, parseShadowBlur } from "../parse";
import type { CheckContext } from "./context";

export function checkElevation(c: CheckContext): void {
    // Shadow: compare resolved CSS string or just confirm the renderer set
    // a non-empty box-shadow. We deliberately don't byte-compare — small
    // colour/blur rounding shouldn't flag — but missing it entirely is a real bug.
    const expectedShadow =
      typeof c.node.shadow === "string" && c.node.shadow.startsWith("$s")
        ? c.tokens.shadow[c.node.shadow]
        : c.node.shadow;
    if (expectedShadow && (!c.styles.boxShadow || c.styles.boxShadow === "none")) {
      c.push("shadow.missing", expectedShadow, c.styles.boxShadow ?? "(unset)", "error");
    } else if (expectedShadow && c.styles.boxShadow) {
      // Shadow present but visibly off — a 2px blur where the design has a 24px
      // soft drop is the kind of "tiny detail" that quietly cheapens a build.
      const expBlur = parseShadowBlur(expectedShadow);
      const renBlur = parseShadowBlur(c.styles.boxShadow);
      if (expBlur !== null && renBlur !== null) {
        const diff = Math.abs(expBlur - renBlur);
        if (diff > c.tol.px.warn) {
          c.push("shadow.blur", expBlur, renBlur, "warn");
        }
      }
    }

    // Backdrop filter (glassmorphism / frosted surfaces). PDS carries a CSS-ready
    // `backdrop-filter` string; agents routinely drop it, leaving a flat opaque
    // panel where the design had a translucent blurred one. A missing backdrop is
    // an error; a present-but-different blur radius is a warn.
    if (c.node.backdropFilter) {
      const ren = (c.styles.backdropFilter ?? "").trim();
      if (!ren || ren.toLowerCase() === "none") {
        c.push("backdrop.missing", c.node.backdropFilter, ren || "(unset)", "error");
      } else {
        const expBlur = parseBlurRadius(c.node.backdropFilter);
        const renBlur = parseBlurRadius(ren);
        if (expBlur !== null && renBlur !== null) {
          const diff = Math.abs(expBlur - renBlur);
          if (diff > c.tol.px.warn) {
            c.push("backdrop.blur", expBlur, renBlur, "warn");
          }
        }
      }
    }
}
