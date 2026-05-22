/** Round to `places` decimals; trims float noise from Figma geometry. */
export function round(n: number, places = 0): number {
  const f = 10 ** places;
  return Math.round(n * f) / f;
}

/** Clamp into the 0..1 range used by Figma colour channels. */
export function clamp01(n: number): number {
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}
