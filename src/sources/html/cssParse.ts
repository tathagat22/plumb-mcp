/**
 * CSS computed-value parsers the HTML adapter needs that nothing else in
 * the codebase provides — every existing string-builder in the codebase
 * goes the OTHER direction (a structured Figma paint/effect → a CSS
 * string, e.g. `normalize/paint.ts`'s `effectsToCss`). Parsing a browser's
 * own computed `box-shadow`/gradient syntax back into `PdsNode`'s `Effect`/
 * `Fill` shapes is new. Deliberately conservative: a gradient or shadow
 * form this doesn't recognize returns `undefined`/`[]` rather than a wrong
 * guess — same discipline as everything else in `src/semantic`.
 */
import { parseColor } from "../../verify";
import type { Effect, Fill, GradientStop } from "../../pds";

function toHex(rgba: { r: number; g: number; b: number; a: number }): string {
  const ch = (n: number) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, "0");
  const hex = `#${ch(rgba.r)}${ch(rgba.g)}${ch(rgba.b)}`;
  return rgba.a < 1 ? `${hex}${ch(rgba.a * 255)}` : hex;
}

/** Splits on a separator at paren-depth 0 — a plain `.split(",")` would
 *  break on `rgba(0, 0, 0, 0.5)`'s own internal commas. */
function splitTopLevel(css: string, separator: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = "";
  for (const char of css) {
    if (char === "(") depth++;
    else if (char === ")") depth--;
    if (char === separator && depth === 0) {
      parts.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }
  if (current.trim()) parts.push(current.trim());
  return parts;
}

/** `getComputedStyle().backgroundImage` for a gradient, e.g.
 *  `"linear-gradient(90deg, rgb(12, 140, 233) 0%, rgb(255, 0, 102) 100%)"`.
 *  Linear gradients only for now — radial/conic use a materially different
 *  descriptor grammar (shape, size, position keywords) that's a separate,
 *  larger parser; returning `undefined` for them is correct abstention,
 *  not a bug. */
export function parseGradient(css: string): Fill | undefined {
  const match = /^linear-gradient\((.+)\)$/.exec(css.trim());
  if (!match?.[1]) return undefined;

  const segments = splitTopLevel(match[1], ",");
  if (segments.length < 2) return undefined;

  let angle = 180; // CSS default direction (to bottom) when unspecified
  let stopSegments = segments;
  const angleMatch = /^(-?[\d.]+)deg$/.exec(segments[0] ?? "");
  if (angleMatch?.[1]) {
    angle = parseFloat(angleMatch[1]);
    stopSegments = segments.slice(1);
  }

  const stops: GradientStop[] = [];
  for (const segment of stopSegments) {
    const posMatch = /([\d.]+)%\s*$/.exec(segment);
    const colorPart = posMatch ? segment.slice(0, posMatch.index).trim() : segment;
    const rgba = parseColor(colorPart);
    if (!rgba) return undefined; // one unparseable stop — abstain on the whole gradient
    stops.push({ at: posMatch?.[1] ? parseFloat(posMatch[1]) / 100 : stops.length === 0 ? 0 : 1, color: toHex(rgba) });
  }
  if (stops.length < 2) return undefined;

  return { type: "linear-gradient", angle, stops };
}

/** `getComputedStyle().boxShadow`, e.g.
 *  `"rgba(0, 0, 0, 0.1) 0px 4px 6px -1px, rgba(0, 0, 0, 0.06) 0px 2px 4px -2px"`
 *  — Chrome's computed form puts color first and always includes all 4
 *  lengths; `inset` (when present) can appear at either end depending on
 *  engine, so both are checked. Returns one entry per comma-separated
 *  shadow, skipping (not failing on) any segment it can't parse. */
export function parseBoxShadow(css: string): Effect[] {
  const trimmed = css.trim();
  if (!trimmed || trimmed === "none") return [];

  const effects: Effect[] = [];
  for (const raw of splitTopLevel(trimmed, ",")) {
    let segment = raw.trim();
    let inset = false;
    if (/^inset\s+/.test(segment)) {
      inset = true;
      segment = segment.replace(/^inset\s+/, "");
    } else if (/\s+inset$/.test(segment)) {
      inset = true;
      segment = segment.replace(/\s+inset$/, "");
    }

    const colorMatch = /^(rgba?\([^)]*\)|#[0-9a-fA-F]+)/.exec(segment);
    if (!colorMatch?.[1]) continue;
    const rgba = parseColor(colorMatch[1]);
    if (!rgba) continue;

    const lengths = segment
      .slice(colorMatch[1].length)
      .trim()
      .split(/\s+/)
      .map((v) => parseFloat(v))
      .filter((n) => !Number.isNaN(n));
    if (lengths.length < 2) continue;

    const [x = 0, y = 0, blur = 0, spread = 0] = lengths;
    effects.push({ type: inset ? "inner-shadow" : "drop-shadow", x, y, blur, spread, color: toHex(rgba) });
  }
  return effects;
}
