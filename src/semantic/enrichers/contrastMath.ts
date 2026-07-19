/**
 * WCAG 2.x contrast math — pure, no graph/enricher knowledge, so it's
 * trivially unit-testable against the W3C reference values.
 * https://www.w3.org/TR/WCAG21/#dfn-relative-luminance
 *
 * Known simplification: alpha is parsed but ignored for luminance — a
 * partially-transparent fill technically blends with whatever is behind
 * it too (alpha compositing), which this does not model. Documented, not
 * silently wrong: `AccessibilityEnricher` treats every contrast finding as
 * a heuristic estimate, not a certified WCAG audit.
 */
export interface Rgb {
  r: number;
  g: number;
  b: number;
}

const HEX_RE = /^#([0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;

export function parseHexColor(hex: string): Rgb | null {
  const m = HEX_RE.exec(hex.trim());
  if (!m) return null;
  const v = m[1] as string;
  return {
    r: parseInt(v.slice(0, 2), 16),
    g: parseInt(v.slice(2, 4), 16),
    b: parseInt(v.slice(4, 6), 16),
  };
}

function channelLuminance(c8bit: number): number {
  const c = c8bit / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

export function relativeLuminance({ r, g, b }: Rgb): number {
  return 0.2126 * channelLuminance(r) + 0.7152 * channelLuminance(g) + 0.0722 * channelLuminance(b);
}

/** (L1 + 0.05) / (L2 + 0.05), L1 the lighter of the two — always ≥ 1. */
export function contrastRatio(a: Rgb, b: Rgb): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const lighter = Math.max(la, lb);
  const darker = Math.min(la, lb);
  return (lighter + 0.05) / (darker + 0.05);
}

export type WcagLevel = "fail" | "AA" | "AAA";

/** `isLargeText`: ≥24px, or ≥18.66px (14pt) bold — callers that don't track
 *  weight in the CIR yet (see graph.ts's style scope note) may pass the
 *  ≥24px-only approximation; documented as a known simplification, not a
 *  silent one. */
export function wcagLevel(ratio: number, isLargeText: boolean): WcagLevel {
  const aaThreshold = isLargeText ? 3.0 : 4.5;
  const aaaThreshold = isLargeText ? 4.5 : 7.0;
  if (ratio >= aaaThreshold) return "AAA";
  if (ratio >= aaThreshold) return "AA";
  return "fail";
}
