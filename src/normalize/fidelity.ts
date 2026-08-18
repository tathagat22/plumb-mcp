/**
 * The small conversions that decide whether a build looks *right* rather than
 * merely correct: absolute position, corner radius (including Figma's
 * fully-rounded sentinel), blend mode, text case, text auto-resize, and
 * constraints — plus the human-readable notes that ride along on a node.
 */

import type { FigmaNode } from "../figma/types";
import { cleanPx, round } from "../util/num";

/**
 * Position of `child` relative to `parent`'s top-left, in CSS pixels. Returns
 * undefined when the parent's auto-layout resolves placement (so emitting x/y
 * would be redundant noise) or when bounding boxes are missing. The "Absolute
 * position" toggle on an auto-layout child surfaces as layoutPositioning ===
 * "ABSOLUTE" — we honour that override.
 */
export function relativePos(
  parent: FigmaNode | undefined,
  child: FigmaNode,
): { x: number; y: number } | undefined {
  if (!parent) return undefined;
  const pbb = parent.absoluteBoundingBox;
  const cbb = child.absoluteBoundingBox;
  if (!pbb || !cbb) return undefined;
  const parentMode = parent.layoutMode;
  const autoLayoutParent = parentMode === "HORIZONTAL" || parentMode === "VERTICAL";
  const absoluteChild =
    (child as { layoutPositioning?: string }).layoutPositioning === "ABSOLUTE";
  if (autoLayoutParent && !absoluteChild) return undefined;
  return { x: round(cbb.x - pbb.x), y: round(cbb.y - pbb.y) };
}

/**
 * Figma stores "fully rounded" (pill / circle) as a sentinel integer that's
 * either far larger than any reasonable px value (`21243700`, `33990048`,
 * `105.157…` against a 60px tall pill) or any radius >= half the smaller box
 * dimension. Either way, CSS would round to a circle — surface that intent.
 */
function isFullRadius(r: number, box: { w: number; h: number }): boolean {
  if (!Number.isFinite(r) || r <= 0) return false;
  const minSide = Math.min(box.w, box.h);
  if (minSide > 0 && r >= minSide / 2) return true;
  return r >= 9999;
}

export function cornerRadius(
  fn: FigmaNode,
  box: { w: number; h: number },
): number | "full" | [number, number, number, number] | undefined {
  if (fn.rectangleCornerRadii) {
    const [a, b, c, d] = fn.rectangleCornerRadii;
    if (a === b && b === c && c === d) {
      if (!a) return undefined;
      return isFullRadius(a, box) ? "full" : cleanPx(a);
    }
    const halfMin = Math.min(box.w, box.h) / 2;
    return fn.rectangleCornerRadii.map((r) =>
      cleanPx(isFullRadius(r, box) ? halfMin : r),
    ) as [number, number, number, number];
  }
  if (typeof fn.cornerRadius === "number") {
    if (!fn.cornerRadius) return undefined;
    return isFullRadius(fn.cornerRadius, box) ? "full" : cleanPx(fn.cornerRadius);
  }
  return undefined;
}

export function buildNotes(fn: FigmaNode): string[] {
  const notes: string[] = [];
  if (fn.layoutMode && fn.layoutMode !== "NONE") {
    notes.push(`auto-layout ${fn.layoutMode}`);
  }
  if (fn.layoutSizingHorizontal === "FIXED") notes.push("fixed width");
  if (fn.layoutSizingHorizontal === "FILL") notes.push("fills width");
  if (fn.layoutSizingHorizontal === "HUG") notes.push("hugs contents");
  return notes;
}

/* ---------------------------------------------------------------------- */
/* v0.10 Phase 3 — fidelity helpers                                         */
/* ---------------------------------------------------------------------- */

/** Map Figma's blend mode enum to the CSS `mix-blend-mode` keyword. */
export function cssBlendMode(figma: string): string | undefined {
  switch (figma) {
    case "PASS_THROUGH":
    case "NORMAL":
      return undefined;
    case "DARKEN": return "darken";
    case "MULTIPLY": return "multiply";
    case "LINEAR_BURN": return "plus-darker";
    case "COLOR_BURN": return "color-burn";
    case "LIGHTEN": return "lighten";
    case "SCREEN": return "screen";
    case "LINEAR_DODGE": return "plus-lighter";
    case "COLOR_DODGE": return "color-dodge";
    case "OVERLAY": return "overlay";
    case "SOFT_LIGHT": return "soft-light";
    case "HARD_LIGHT": return "hard-light";
    case "DIFFERENCE": return "difference";
    case "EXCLUSION": return "exclusion";
    case "HUE": return "hue";
    case "SATURATION": return "saturation";
    case "COLOR": return "color";
    case "LUMINOSITY": return "luminosity";
    default: return figma.toLowerCase();
  }
}

/** Figma's `textCase` → CSS `text-transform`. `SMALL_CAPS`/`SMALL_CAPS_FORCED`
 *  are a `font-variant` concept, not `text-transform` — omitted rather than
 *  approximated as uppercase (that would misrepresent the actual glyphs). */
export function pdsTextCase(figma: string | undefined): "UPPER" | "LOWER" | "TITLE" | undefined {
  switch (figma) {
    case "UPPER": return "UPPER";
    case "LOWER": return "LOWER";
    case "TITLE": return "TITLE";
    default: return undefined; // ORIGINAL / SMALL_CAPS* / unknown → omit
  }
}

/** Compress Figma's textAutoResize enum into a 1-char-ish PDS hint. */
export function pdsTextGrow(figma: string): "h" | "wh" | "trunc" | undefined {
  switch (figma) {
    case "HEIGHT": return "h";
    case "WIDTH_AND_HEIGHT": return "wh";
    case "TRUNCATE": return "trunc";
    default: return undefined; // NONE / unknown → omit
  }
}

/** Map a single Figma constraint enum to a CSS-shaped keyword. */
export function pdsConstraint(figma: string | undefined, axis: "h" | "v"): string | undefined {
  if (!figma) return undefined;
  switch (figma) {
    case "MIN": return axis === "h" ? "left" : "top";
    case "MAX": return axis === "h" ? "right" : "bottom";
    case "CENTER": return "center";
    case "STRETCH": return "stretch";
    case "SCALE": return "scale";
    default: return undefined;
  }
}
