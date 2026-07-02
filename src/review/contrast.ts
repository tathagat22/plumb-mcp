/**
 * WCAG contrast math for the design critique (blueprint §9, task `critique`).
 *
 * Pure, self-contained, no I/O. `critiqueDesign`'s accessibility dimension uses
 * these to flag text that fails the WCAG 2.1 AA contrast floor against its
 * resolved background. Colour parsing is delegated to the verify engine's
 * `parseColor` (it already handles `#rgb`/`#rrggbb[aa]`/`rgb()/rgba()`), so the
 * two subsystems agree byte-for-byte on how a colour string decodes.
 */
import { parseColor } from "../verify";

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

/** WCAG AA floor for normal-size body text. */
export const AA_NORMAL = 4.5;
/** WCAG AA floor for large text (>= 24px, or >= 18.66px bold). */
export const AA_LARGE = 3;

/**
 * Parse any CSS colour string (hex or rgb/rgba) to an opaque `Rgb`, or null.
 * Alpha is dropped — contrast is computed on the composited opaque colour, and
 * callers that care about translucency composite before calling.
 */
export function toRgb(color: string | undefined): Rgb | null {
  const c = parseColor(color);
  if (!c) return null;
  return { r: c.r, g: c.g, b: c.b };
}

/** sRGB channel (0..255) → linearised component per WCAG 2.1. */
function linearize(channel: number): number {
  const x = channel / 255;
  return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
}

/** WCAG relative luminance of an sRGB colour, 0 (black) … 1 (white). */
export function relativeLuminance(rgb: Rgb): number {
  return (
    0.2126 * linearize(rgb.r) +
    0.7152 * linearize(rgb.g) +
    0.0722 * linearize(rgb.b)
  );
}

/**
 * WCAG contrast ratio between two colours, 1 (identical) … 21 (black vs white).
 * Order-independent.
 */
export function contrastRatio(a: Rgb, b: Rgb): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const lighter = Math.max(la, lb);
  const darker = Math.min(la, lb);
  return (lighter + 0.05) / (darker + 0.05);
}

/**
 * The AA threshold that applies to a given type size/weight. Large text
 * (>= 24px, or >= 18.66px when bold) only needs 3:1; everything else needs 4.5:1.
 */
export function aaThreshold(sizePx: number | undefined, weight: number | undefined): number {
  const size = sizePx ?? 16;
  const bold = (weight ?? 400) >= 700;
  if (size >= 24 || (bold && size >= 18.66)) return AA_LARGE;
  return AA_NORMAL;
}
