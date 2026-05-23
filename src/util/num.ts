/** Round to `places` decimals; trims float noise from Figma geometry. */
export function round(n: number, places = 0): number {
  const f = 10 ** places;
  return Math.round(n * f) / f;
}

/**
 * Clean a px value: round to 2 decimals and snap near-zero float artifacts
 * (Figma's auto-layout sometimes emits 0.0000021801818093081238 for nominally
 * "0" padding) to literal 0. Real sub-pixel values like 0.5 are preserved.
 */
export function cleanPx(n: number): number {
  if (!Number.isFinite(n)) return 0;
  const r = Math.round(n * 100) / 100;
  return Math.abs(r) < 0.01 ? 0 : r;
}

/** Clamp into the 0..1 range used by Figma colour channels. */
export function clamp01(n: number): number {
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}
