/**
 * Colour comparison, in a perceptually uniform space.
 *
 * Distance is ΔE2000 (sRGB → linear → XYZ D65 → Lab → ΔE2000). The metric it
 * replaced was sum-of-absolute-RGB-channel-deltas, which scored "8 units off
 * in each channel" the same as "24 units off in one" even though the first is
 * barely visible and the second is glaring.
 *
 * The user-agent colour keywords live here too: `buttonface` showing up as a
 * computed background is a colour-shaped symptom of a reset that isn't taking.
 */

import type { PdsNode } from "../pds";
import type { Delta, Tolerances } from "./types";

export function pushColorDelta(
  node: PdsNode,
  kind: string,
  expectedHex: string | undefined,
  renderedColor: string,
  tol: Tolerances,
  deltas: Delta[],
): void {
  if (!expectedHex) return;
  const exp = parseColor(expectedHex);
  const actual = parseColor(renderedColor);
  if (!exp || !actual) return;
  const diff = colorDistance(exp, actual);
  if (diff <= tol.color.ok) return;
  deltas.push({
    el: node.el,
    name: node.name,
    kind,
    expected: expectedHex,
    actual: rgbToHex(actual),
    diff,
    severity: diff > tol.color.warn ? "error" : "warn",
  });
}

/* ---------------------------------------------------------------------- */
/* Parsers — all return null on anything unrecognised                      */
/* ---------------------------------------------------------------------- */

export interface Rgba {
  r: number;
  g: number;
  b: number;
  a: number;
}

export function parseColor(s: string | undefined): Rgba | null {
  if (!s) return null;
  const t = s.trim().toLowerCase();
  if (t === "" || t === "transparent" || t === "none" || t === "currentcolor") return null;

  const hexMatch = t.match(/^#([0-9a-f]+)$/);
  if (hexMatch && hexMatch[1]) {
    let hex = hexMatch[1];
    if (hex.length === 3 || hex.length === 4) {
      hex = hex
        .split("")
        .map((c) => c + c)
        .join("");
    }
    if (hex.length === 6 || hex.length === 8) {
      const r = parseInt(hex.slice(0, 2), 16);
      const g = parseInt(hex.slice(2, 4), 16);
      const b = parseInt(hex.slice(4, 6), 16);
      const a = hex.length === 8 ? parseInt(hex.slice(6, 8), 16) / 255 : 1;
      if (![r, g, b].some(Number.isNaN)) return { r, g, b, a };
    }
    return null;
  }

  const rgbMatch = t.match(/^rgba?\s*\(([^)]+)\)$/);
  if (rgbMatch && rgbMatch[1]) {
    const parts = rgbMatch[1].split(/[\s,/]+/).filter(Boolean);
    if (parts.length >= 3) {
      const r = Math.round(parseFloat(parts[0]!));
      const g = Math.round(parseFloat(parts[1]!));
      const b = Math.round(parseFloat(parts[2]!));
      const a = parts[3] !== undefined ? parseFloat(parts[3]) : 1;
      if (![r, g, b].some(Number.isNaN)) {
        return { r, g, b, a: Number.isNaN(a) ? 1 : a };
      }
    }
  }
  return null;
}

/**
 * Perceptually-uniform colour distance. Replaces the v0.9 RGB-Manhattan
 * metric, which scored "8 units off in each channel" the same as
 * "24 units off in one channel" even though the former is barely visible
 * and the latter is glaring. ΔE2000 fixes both halves of that bug.
 *
 * Implementation: sRGB → linear → XYZ (D65) → Lab → ΔE2000. Numbers
 * track the CIE 2000 colour-difference formula exactly enough for the
 * 0..10 range agents see in practice; no parametric weighting (kL=kC=kH=1).
 */
function colorDistance(a: Rgba, b: Rgba): number {
  const la = rgbaToLab(a);
  const lb = rgbaToLab(b);
  return deltaE2000(la, lb);
}

interface Lab {
  l: number;
  a: number;
  b: number;
}

function srgbToLinear(c: number): number {
  const x = c / 255;
  return x <= 0.04045 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
}

function rgbaToLab({ r, g, b }: Rgba): Lab {
  const R = srgbToLinear(r);
  const G = srgbToLinear(g);
  const B = srgbToLinear(b);
  // sRGB → XYZ (D65) per IEC 61966-2-1.
  const X = R * 0.4124564 + G * 0.3575761 + B * 0.1804375;
  const Y = R * 0.2126729 + G * 0.7151522 + B * 0.072175;
  const Z = R * 0.0193339 + G * 0.119192 + B * 0.9503041;
  // XYZ → Lab (D65 reference white).
  const Xn = 0.95047;
  const Yn = 1.0;
  const Zn = 1.08883;
  const f = (t: number): number => (t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27) * t / 116 + 16 / 116);
  const fx = f(X / Xn);
  const fy = f(Y / Yn);
  const fz = f(Z / Zn);
  return { l: 116 * fy - 16, a: 500 * (fx - fy), b: 200 * (fy - fz) };
}

function deltaE2000(la: Lab, lb: Lab): number {
  const deg = (rad: number): number => (rad * 180) / Math.PI;
  const rad = (d: number): number => (d * Math.PI) / 180;

  const Lbar = (la.l + lb.l) / 2;
  const C1 = Math.hypot(la.a, la.b);
  const C2 = Math.hypot(lb.a, lb.b);
  const Cbar = (C1 + C2) / 2;
  const G = 0.5 * (1 - Math.sqrt(Math.pow(Cbar, 7) / (Math.pow(Cbar, 7) + Math.pow(25, 7))));
  const a1 = la.a * (1 + G);
  const a2 = lb.a * (1 + G);
  const C1p = Math.hypot(a1, la.b);
  const C2p = Math.hypot(a2, lb.b);
  const Cpbar = (C1p + C2p) / 2;
  const h1 = Math.atan2(la.b, a1);
  const h2 = Math.atan2(lb.b, a2);
  const h1d = ((deg(h1) % 360) + 360) % 360;
  const h2d = ((deg(h2) % 360) + 360) % 360;

  let dhp = h2d - h1d;
  if (Math.abs(dhp) > 180) dhp += dhp > 0 ? -360 : 360;
  const dLp = lb.l - la.l;
  const dCp = C2p - C1p;
  const dHp = 2 * Math.sqrt(C1p * C2p) * Math.sin(rad(dhp / 2));

  let Hpbar = h1d + h2d;
  if (Math.abs(h1d - h2d) > 180) Hpbar += Hpbar < 360 ? 360 : -360;
  Hpbar /= 2;

  const T =
    1 -
    0.17 * Math.cos(rad(Hpbar - 30)) +
    0.24 * Math.cos(rad(2 * Hpbar)) +
    0.32 * Math.cos(rad(3 * Hpbar + 6)) -
    0.2 * Math.cos(rad(4 * Hpbar - 63));
  const SL = 1 + (0.015 * Math.pow(Lbar - 50, 2)) / Math.sqrt(20 + Math.pow(Lbar - 50, 2));
  const SC = 1 + 0.045 * Cpbar;
  const SH = 1 + 0.015 * Cpbar * T;
  const dTheta = 30 * Math.exp(-Math.pow((Hpbar - 275) / 25, 2));
  const RC = 2 * Math.sqrt(Math.pow(Cpbar, 7) / (Math.pow(Cpbar, 7) + Math.pow(25, 7)));
  const RT = -RC * Math.sin(2 * rad(dTheta));

  return Math.sqrt(
    Math.pow(dLp / SL, 2) +
      Math.pow(dCp / SC, 2) +
      Math.pow(dHp / SH, 2) +
      RT * (dCp / SC) * (dHp / SH),
  );
}

function rgbToHex(c: Rgba): string {
  const ch = (n: number): string =>
    Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, "0");
  const base = `#${ch(c.r)}${ch(c.g)}${ch(c.b)}`;
  return c.a >= 1 ? base : base + ch(c.a * 255);
}

const UA_COLOR_KEYWORDS = new Set([
  "buttonface",
  "buttontext",
  "field",
  "fieldtext",
  "highlight",
  "highlighttext",
  "graytext",
  "menu",
  "menutext",
  "window",
  "windowframe",
  "windowtext",
  "linktext",
  "visitedtext",
  "activetext",
  "activeborder",
  "inactiveborder",
  "infobackground",
  "infotext",
  "scrollbar",
  "threeddarkshadow",
  "threedface",
  "threedhighlight",
  "threedlightshadow",
  "threedshadow",
]);

/**
 * True when a CSS color value is a user-agent system keyword. Chrome computes
 * `<button>` and `<input>` backgrounds to these when the page's CSS reset
 * fails to override — the symptom of the real-world dashboard-pill
 * regression that motivated check #16.
 */
export function isUserAgentColor(s: string): boolean {
  if (!s) return false;
  return UA_COLOR_KEYWORDS.has(s.trim().toLowerCase());
}
