/**
 * Brand palette extraction — derive a real, usable palette from a live
 * reference site by reading its COMPUTED CSS (not by quantizing screenshot
 * pixels). The page already declares its brand as background/text/border
 * colours; sampling those, weighted by on-screen area, yields the exact hexes
 * the designers chose — far cleaner than averaging JPEG-y pixels.
 */
import { evaluate, type Browser } from "../cli/cdp";

export interface WeightedColor {
  hex: string;
  w: number;
}
export interface RawPalette {
  bg: WeightedColor[];
  text: WeightedColor[];
  border: WeightedColor[];
}

/** Semantic palette in Plumb's brand-token shape. */
export interface BrandColors {
  bg: string;
  surface: string;
  elevated: string;
  text: string;
  muted: string;
  primary: string;
  onPrimary: string;
  border: string;
  accent: string;
}

/* --- page-side sampler (runs in the reference site's own context) --------- */

const SAMPLE_SCRIPT = `(() => {
  const hex = (r,g,b) => '#' + [r,g,b].map(x => Math.max(0,Math.min(255,x)).toString(16).padStart(2,'0')).join('');
  const parse = (s) => {
    const m = /rgba?\\(([^)]+)\\)/.exec(s || ''); if (!m) return null;
    const p = m[1].split(',').map(x => parseFloat(x));
    if (p.length >= 4 && p[3] === 0) return null;      // fully transparent
    if (p.some(n => Number.isNaN(n))) return null;
    return hex(Math.round(p[0]), Math.round(p[1]), Math.round(p[2]));
  };
  const bg = new Map(), tx = new Map(), bd = new Map();
  const add = (map, h, w) => { if (h) map.set(h, (map.get(h) || 0) + w); };
  const els = document.querySelectorAll('body *');
  let n = 0;
  for (const el of els) {
    if (n++ > 5000) break;
    const r = el.getBoundingClientRect();
    if (r.width < 4 || r.height < 4 || r.bottom < 0 || r.top > 6000) continue;
    const cs = getComputedStyle(el);
    add(bg, parse(cs.backgroundColor), Math.min(r.width * r.height, 2500000));
    const t = (el.textContent || '').trim();
    if (t.length > 0 && t.length < 400) add(tx, parse(cs.color), r.width * 24);
    if (parseFloat(cs.borderTopWidth) > 0) add(bd, parse(cs.borderTopColor), r.width);
  }
  const top = (map, k) => [...map.entries()].sort((a,b) => b[1]-a[1]).slice(0,k).map(([hex,w]) => ({hex,w}));
  return { bg: top(bg,10), text: top(tx,10), border: top(bd,8) };
})()`;

/** Sample the currently-loaded page's palette (call while on the page). */
export async function extractRawPalette(b: Browser): Promise<RawPalette> {
  const raw = await evaluate<RawPalette>(b, SAMPLE_SCRIPT);
  return { bg: raw?.bg ?? [], text: raw?.text ?? [], border: raw?.border ?? [] };
}

/* --- colour maths --------------------------------------------------------- */

function rgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}
/** Relative luminance 0..1 (WCAG). */
function lum([r, g, b]: [number, number, number]): number {
  const f = (c: number): number => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}
/** Saturation/chroma proxy 0..1 — how "colourful" (non-grey) a hex is. */
function chroma([r, g, b]: [number, number, number]): number {
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
  return mx === 0 ? 0 : (mx - mn) / mx;
}
function mix(a: string, b: string, t: number): string {
  const [r1, g1, b1] = rgb(a), [r2, g2, b2] = rgb(b);
  const h = (x: number): string => Math.round(x).toString(16).padStart(2, "0");
  return `#${h(r1 + (r2 - r1) * t)}${h(g1 + (g2 - g1) * t)}${h(b1 + (b2 - b1) * t)}`;
}
function contrast(a: string, b: string): number {
  const la = lum(rgb(a)) + 0.05, lb = lum(rgb(b)) + 0.05;
  return la > lb ? la / lb : lb / la;
}
/**
 * Nudge `fg` toward `toward` (in small steps) until it clears `target` contrast
 * against `bg`. Used to guarantee a role (e.g. muted secondary text) meets WCAG
 * AA on the lightest surface it renders on — a synthesized brand otherwise
 * happily ships a muted grey that fails AA everywhere it's used.
 */
function ensureContrast(fg: string, bg: string, target: number, toward: string): string {
  let out = fg;
  for (let i = 0; i < 16 && contrast(out, bg) < target; i += 1) {
    out = mix(out, toward, 0.1);
  }
  return out;
}
/** Hue angle 0..360 (HSL). Used to group colours from different references
 *  that are "the same brand colour" without requiring exact hex matches. */
function hue([r, g, b]: [number, number, number]): number {
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  if (d === 0) return 0;
  let h: number;
  if (mx === r) h = ((g - b) / d) % 6;
  else if (mx === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  h *= 60;
  return h < 0 ? h + 360 : h;
}

/**
 * Turn a raw sampled palette into a coherent semantic brand. Heuristics:
 * the biggest-area background sets the ground (and whether the theme is dark);
 * text is the highest-weight colour that clears contrast; the accent is the
 * most chromatic non-grey colour anywhere in the sample.
 */
export function synthesizeBrand(raw: RawPalette): BrandColors {
  const bgHex = raw.bg[0]?.hex ?? "#0A0A0B";
  const dark = lum(rgb(bgHex)) < 0.35;
  const white = "#FFFFFF", black = "#000000";

  // Surface / elevated: nudge the ground toward the opposite end a touch.
  const surface = mix(bgHex, dark ? white : black, dark ? 0.05 : 0.03);
  const elevated = mix(bgHex, dark ? white : black, dark ? 0.1 : 0.06);
  // Border: a hairline — modest contrast against the ground and near-neutral.
  // A full-white/black border sample is a stray rule, not the brand's hairline.
  const border =
    raw.border.map((c) => c.hex).find((h) => {
      const cr = contrast(h, bgHex);
      return cr >= 1.08 && cr <= 3 && chroma(rgb(h)) < 0.4;
    }) ?? mix(bgHex, dark ? white : black, dark ? 0.16 : 0.12);

  // Text: prefer a sampled text colour that actually clears contrast on the bg.
  const textCand = raw.text.find((c) => contrast(c.hex, bgHex) >= 4.5)?.hex;
  const text = textCand ?? (dark ? "#F4F4F5" : "#0A0A0B");
  // Muted: a NEUTRAL secondary text (low chroma, mid contrast) — never a
  // colourful one, or a stray badge colour leaks in as "muted". Then clamp it to
  // WCAG AA against the LIGHTEST surface it renders on (elevated), so a too-dark
  // muted can't ship failing contrast on cards/surfaces across the whole design.
  const mutedCand =
    raw.text.map((c) => c.hex).find((h) => {
      const cr = contrast(h, bgHex);
      return cr >= 2 && cr < 4.5 && chroma(rgb(h)) < 0.22;
    }) ?? mix(text, bgHex, 0.45);
  const muted = ensureContrast(mutedCand, elevated, 4.5, text);

  // Accent: the most chromatic colour, but weight-aware — a link/button colour
  // that actually covers area, not a one-off pixel from an illustration.
  const all = [...raw.bg, ...raw.text, ...raw.border];
  let accent = "";
  let bestScore = 0;
  for (const c of all) {
    const px = rgb(c.hex);
    const ch = chroma(px);
    const l = lum(px);
    if (ch < 0.3 || l < 0.03 || l > 0.95) continue; // near-grey or too dark/light
    const score = ch * Math.sqrt(Math.max(1, c.w));
    if (score > bestScore) {
      bestScore = score;
      accent = c.hex;
    }
  }
  if (!accent) accent = dark ? "#6E7BFF" : "#3B5BFF";
  const onPrimary = contrast(white, accent) >= contrast(black, accent) ? "#FFFFFF" : "#0A0A0B";

  return { bg: bgHex, surface, elevated, text, muted, primary: accent, onPrimary, border, accent };
}

/**
 * Blend a coherent brand across MULTIPLE reference palettes, instead of
 * anchoring on a single site. Where {@link synthesizeBrand} takes the top
 * reference's numbers at face value, this:
 *  - picks bg/text by majority light-vs-dark vote across all references, then
 *    the median (most "typical") candidate within that mode — so one outlier
 *    reference can't swing the whole brand;
 *  - scores the accent by chroma×weight PER REFERENCE, then buckets every
 *    candidate by hue (30°-wide) and sums scores per bucket — the hue bucket
 *    the references most agree on (by combined chroma×area, not just one
 *    site's loudest pixel) wins.
 * Falls back to {@link synthesizeBrand} when there's nothing (or only one) to
 * blend across.
 */
export function synthesizeBrandFromMany(raws: RawPalette[]): BrandColors {
  const valid = raws.filter((r) => r.bg.length || r.text.length || r.border.length);
  if (valid.length <= 1) return synthesizeBrand(valid[0] ?? { bg: [], text: [], border: [] });

  const white = "#FFFFFF", black = "#000000";

  // --- Background: majority dark/light vote, then the median-luminance
  // candidate within that mode.
  const bgCandidates = valid.map((r) => r.bg[0]).filter((c): c is WeightedColor => !!c);
  if (bgCandidates.length === 0) return synthesizeBrand(valid[0] as RawPalette);

  const darkVotes = bgCandidates.filter((c) => lum(rgb(c.hex)) < 0.35).length;
  const wantDark = darkVotes * 2 >= bgCandidates.length;
  const modeMatched = bgCandidates.filter((c) => (lum(rgb(c.hex)) < 0.35) === wantDark);
  const bgPool = modeMatched.length ? modeMatched : bgCandidates;
  const bgByLum = [...bgPool].sort((a, b) => lum(rgb(a.hex)) - lum(rgb(b.hex)));
  const bgHex = bgByLum[Math.floor(bgByLum.length / 2)]!.hex;
  const dark = lum(rgb(bgHex)) < 0.35;

  const surface = mix(bgHex, dark ? white : black, dark ? 0.05 : 0.03);
  const elevated = mix(bgHex, dark ? white : black, dark ? 0.1 : 0.06);

  // --- Border: pool every reference's border candidates, same hairline
  // heuristic as synthesizeBrand, scored against the blended bg.
  const border =
    valid
      .flatMap((r) => r.border)
      .map((c) => c.hex)
      .find((h) => {
        const cr = contrast(h, bgHex);
        return cr >= 1.08 && cr <= 3 && chroma(rgb(h)) < 0.4;
      }) ?? mix(bgHex, dark ? white : black, dark ? 0.16 : 0.12);

  // --- Text: every reference's contrast-clearing text candidates against the
  // blended bg, then the median-luminance one among them.
  const textCandidates = valid.flatMap((r) => r.text).filter((c) => contrast(c.hex, bgHex) >= 4.5);
  let text: string;
  if (textCandidates.length) {
    const byLum = [...textCandidates].sort((a, b) => lum(rgb(a.hex)) - lum(rgb(b.hex)));
    text = byLum[Math.floor(byLum.length / 2)]!.hex;
  } else {
    text = dark ? "#F4F4F5" : "#0A0A0B";
  }

  const mutedCand =
    valid
      .flatMap((r) => r.text)
      .map((c) => c.hex)
      .find((h) => {
        const cr = contrast(h, bgHex);
        return cr >= 2 && cr < 4.5 && chroma(rgb(h)) < 0.22;
      }) ?? mix(text, bgHex, 0.45);
  // Clamp muted to WCAG AA on the lightest surface it renders on (see synthesizeBrand).
  const muted = ensureContrast(mutedCand, elevated, 4.5, text);

  // --- Accent: pool every colour from every reference; bucket by hue and sum
  // chroma×weight per bucket — the hue the references agree on most wins.
  const allColors = valid.flatMap((r) => [...r.bg, ...r.text, ...r.border]);
  const buckets = new Map<number, { score: number; best: string; bestScore: number }>();
  for (const c of allColors) {
    const px = rgb(c.hex);
    const ch = chroma(px);
    const l = lum(px);
    if (ch < 0.3 || l < 0.03 || l > 0.95) continue; // near-grey or too dark/light
    const bucket = Math.round(hue(px) / 30) % 12;
    const score = ch * Math.sqrt(Math.max(1, c.w));
    const entry = buckets.get(bucket) ?? { score: 0, best: "", bestScore: 0 };
    entry.score += score;
    if (score > entry.bestScore) {
      entry.bestScore = score;
      entry.best = c.hex;
    }
    buckets.set(bucket, entry);
  }
  let accent = "";
  let bestBucketScore = 0;
  for (const entry of buckets.values()) {
    if (entry.score > bestBucketScore) {
      bestBucketScore = entry.score;
      accent = entry.best;
    }
  }
  if (!accent) accent = dark ? "#6E7BFF" : "#3B5BFF";
  const onPrimary = contrast(white, accent) >= contrast(black, accent) ? "#FFFFFF" : "#0A0A0B";

  return { bg: bgHex, surface, elevated, text, muted, primary: accent, onPrimary, border, accent };
}
