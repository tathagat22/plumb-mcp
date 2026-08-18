/**
 * Parsers for the strings `getComputedStyle` hands back.
 *
 * Every one returns `null` rather than a guess when the input is unrecognised.
 * That matters more here than it looks: a wrong number becomes a delta
 * reported against the user's build, so "I don't know" has to be
 * representable and has to be distinguishable from "zero".
 */


/**
 * Pull a Z rotation in degrees out of a CSS `transform` string. Handles
 * the common `rotate(45deg)` and the 2D `matrix(a,b,c,d,...)` form.
 * Returns null on `none`, 3D matrices, and anything we don't recognise.
 */
export function parseRotation(transform: string | undefined): number | null {
  if (!transform || transform === "none") return null;
  const rot = transform.match(/rotate(?:Z)?\(\s*(-?\d+(?:\.\d+)?)deg\s*\)/);
  if (rot && rot[1]) return Number(rot[1]);
  const m2 = transform.match(/^matrix\(\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)/);
  if (m2 && m2[1] && m2[2]) {
    const a = Number(m2[1]);
    const b = Number(m2[2]);
    return (Math.atan2(b, a) * 180) / Math.PI;
  }
  return null;
}

export function round(n: number, places: number): number {
  const p = Math.pow(10, places);
  return Math.round(n * p) / p;
}

/**
 * Pull the blur radius out of a CSS filter function string — `blur(12px)`,
 * `blur(12px) saturate(180%)`, etc. Returns the first blur in px, or null.
 */
export function parseBlurRadius(s: string | undefined): number | null {
  if (!s) return null;
  const m = s.match(/blur\(\s*(-?\d+(?:\.\d+)?)px\s*\)/i);
  return m && m[1] ? parseFloat(m[1]) : null;
}

/**
 * The blur radius of a box-shadow. Computed box-shadow normalises to
 * `<color> <offX> <offY> <blur> [<spread>]`; design tokens may put the colour
 * last. Either way, stripping colour functions + the `inset` keyword leaves the
 * offset/blur/spread numbers in order, and blur is the third (index 2).
 */
export function parseShadowBlur(s: string | undefined): number | null {
  if (!s || s === "none") return null;
  // Only the first shadow layer matters for a rough magnitude check.
  const first = s.split(/,(?![^()]*\))/)[0] ?? s;
  const stripped = first
    .replace(/(?:rgba?|hsla?)\([^)]*\)/gi, " ")
    .replace(/#[0-9a-f]+/gi, " ")
    .replace(/\binset\b/gi, " ");
  const nums = stripped.match(/-?\d+(?:\.\d+)?px/gi);
  if (!nums || nums.length < 3) return null;
  return parseFloat(nums[2]!);
}

export function parsePx(s: string | undefined): number | null {
  if (s === undefined || s === null) return null;
  const t = s.trim();
  if (t === "0") return 0;
  if (t === "" || t === "auto" || t === "normal") return null;
  const m = t.match(/^(-?\d+(?:\.\d+)?)\s*px$/i);
  if (m && m[1]) return parseFloat(m[1]);
  const n = parseFloat(t);
  return Number.isFinite(n) ? n : null;
}

export function parseTextToken(
  s: string,
): { weight: number; size: number; lh?: number; family?: string } | null {
  const m = s.trim().match(
    /^(\d+)\s+(\d+(?:\.\d+)?)px(?:\s*\/\s*(\d+(?:\.\d+)?))?\s*(.*)$/,
  );
  if (!m || !m[1] || !m[2]) return null;
  const family = m[4] && m[4].trim() ? m[4].trim() : undefined;
  return {
    weight: parseInt(m[1], 10),
    size: parseFloat(m[2]),
    lh: m[3] ? parseFloat(m[3]) : undefined,
    family,
  };
}

export function normalizeWeight(s: string | undefined): number | null {
  if (!s) return null;
  if (/^\d+$/.test(s)) return parseInt(s, 10);
  const map: Record<string, number> = {
    normal: 400,
    bold: 700,
    lighter: 300,
    bolder: 800,
  };
  return map[s.toLowerCase()] ?? null;
}

export function computeLineHeightRatio(
  lh: string | undefined,
  size: number | null,
): number | null {
  if (!lh) return null;
  const t = lh.trim();

  // Order matters. `parsePx` falls back to a bare `parseFloat`, so it happily
  // turns "1.5" into 1.5 and "150%" into 150 — and dividing either by the font
  // size gives a ratio that is wrong by a factor of the font size. Classify the
  // unit first, and only then convert.
  if (t.endsWith("%")) {
    // A percentage line-height IS the ratio, times 100.
    const pct = parseFloat(t);
    return Number.isFinite(pct) ? pct / 100 : null;
  }

  if (!t.toLowerCase().endsWith("px")) {
    // Unit-less line-height is already a ratio — CSS's own definition.
    const n = parseFloat(t);
    return Number.isFinite(n) ? n : null;
  }

  const lhPx = parsePx(t);
  if (lhPx !== null && size !== null && size > 0) return lhPx / size;
  return null;
}
