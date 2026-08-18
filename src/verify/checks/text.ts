/**
 * Text: content, colour, decoration, and the type token.
 *
 * Content and fidelity are graded differently on purpose. A wrong colour is
 * always a bug; a wrong string usually isn't, because dropping real content
 * into the design's placeholder slots is the agent's job. So a mismatch on
 * filler degrades to advisory `info` while a mismatch on a real UI label still
 * warns — and style is checked at full strictness either way.
 */

import { pushColorDelta } from "../color";
import { computeLineHeightRatio, normalizeWeight, parsePx, parseTextToken } from "../parse";
import { isPlaceholderText } from "../text";
import type { CheckContext } from "./context";

export function checkText(c: CheckContext): void {
    // --- Text content ------------------------------------------------------
    // Content vs. fidelity: a wrong *colour* or *icon* is always a bug, but a
    // wrong *string* often isn't — the agent is supposed to drop real content
    // into the design's placeholder slots. So a mismatch on filler text (lorem,
    // generic labels, numeric stubs, repeated copy-paste cells, long body copy)
    // is surfaced as advisory `info` (visible, but it doesn't dent the fit score
    // or the fix list). A mismatch on a meaningful UI label still warns.
    if (typeof c.node.chars === "string" && typeof c.r.text === "string") {
      const exp = c.node.chars.trim();
      const act = c.r.text.trim();
      if (exp !== act) {
        const placeholder = isPlaceholderText(exp, c.dupChars.has(exp));
        c.push(placeholder ? "text.placeholder" : "text.chars", exp, act, placeholder ? "info" : "warn");
      }
    }

    // --- Text colour (TEXT nodes use `color` in the browser) ---------------
    if (c.node.type === "text" && c.node.fill && c.node.fill.startsWith("$c") && c.styles.color) {
      pushColorDelta(c.node, "text.color", c.tokens.color[c.node.fill], c.styles.color, c.tol, c.deltas);
    }

    // --- Text decoration (real-world bug #14: missing strike-through on
    //     completed-checklist items) ----------------------------------------
    if (c.node.type === "text" && c.node.textDecoration) {
      const dec = (c.styles.textDecorationLine ?? c.styles.textDecoration ?? "").toLowerCase();
      if (!dec.includes(c.node.textDecoration)) {
        c.push("text.decoration", c.node.textDecoration, dec || "none", "error");
      }
    }

    // --- Text style (font weight / size / line-height / family) ------------
    if (c.node.text && c.node.text.startsWith("$t")) {
      const tk = c.tokens.text[c.node.text];
      const parsed = tk ? parseTextToken(tk) : null;
      if (parsed) {
        const renSize = parsePx(c.styles.fontSize);
        if (renSize !== null) c.pushPx("text.size", parsed.size, renSize, { ok: 0.5, warn: 1.5 });
        const renWeight = normalizeWeight(c.styles.fontWeight);
        if (renWeight !== null && renWeight !== parsed.weight) {
          const diff = Math.abs(renWeight - parsed.weight);
          c.push("text.weight", parsed.weight, renWeight, diff <= 100 ? "warn" : "error");
        }
        if (parsed.lh) {
          const renRatio = computeLineHeightRatio(c.styles.lineHeight, renSize);
          if (renRatio !== null) {
            const diff = Math.abs(renRatio - parsed.lh);
            if (diff > 0.05) {
              c.push("text.lh", parsed.lh, Math.round(renRatio * 100) / 100, diff > 0.15 ? "error" : "warn");
            }
          }
        }
        if (parsed.family && c.styles.fontFamily) {
          const ff = c.styles.fontFamily.toLowerCase();
          if (!ff.includes(parsed.family.toLowerCase())) {
            c.push("text.family", parsed.family, c.styles.fontFamily, "warn");
          }
        }
      }
    }
}
