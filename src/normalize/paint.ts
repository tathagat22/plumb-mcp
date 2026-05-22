import { clamp01, round } from "../util/num";
import type { FigmaEffect, FigmaPaint, FigmaTypeStyle, RgbaColor } from "../figma/types";

function channel(x: number): string {
  return Math.round(clamp01(x) * 255)
    .toString(16)
    .padStart(2, "0");
}

/** Figma RGBA (0..1 channels) → `#rrggbb` or `#rrggbbaa`. */
export function colorToHex(c: RgbaColor): string {
  const hex = `#${channel(c.r)}${channel(c.g)}${channel(c.b)}`;
  const a = c.a ?? 1;
  return a >= 1 ? hex : hex + channel(a);
}

/** First visible paint → a CSS-ready value. Solid → hex; gradient/image → a marker. */
export function paintToCss(paints: FigmaPaint[] | undefined): string | undefined {
  if (!paints?.length) return undefined;
  const p = paints.find((x) => x.visible !== false);
  if (!p) return undefined;
  if (p.type === "SOLID" && p.color) {
    const a = (p.color.a ?? 1) * (p.opacity ?? 1);
    return colorToHex({ r: p.color.r, g: p.color.g, b: p.color.b, a });
  }
  if (p.type.startsWith("GRADIENT")) return "gradient";
  if (p.type === "IMAGE") return "image";
  return undefined;
}

/** Figma type style → a terse `weight size/lineHeight family` string. */
export function typeStyleToCss(s: FigmaTypeStyle | undefined): string | undefined {
  if (!s || s.fontSize == null) return undefined;
  const weight = s.fontWeight ?? 400;
  const size = round(s.fontSize, 2);
  const lh =
    s.lineHeightPx != null && s.fontSize ? `/${round(s.lineHeightPx / s.fontSize, 2)}` : "";
  const family = s.fontFamily ? ` ${s.fontFamily}` : "";
  const tracking = s.letterSpacing ? ` ${round(s.letterSpacing, 2)}px` : "";
  return `${weight} ${size}px${lh}${family}${tracking}`;
}

/** Drop-shadow / inner-shadow effects → a CSS box-shadow string. */
export function effectsToCss(effects: FigmaEffect[] | undefined): string | undefined {
  if (!effects?.length) return undefined;
  const shadows = effects.filter(
    (e) => e.visible !== false && (e.type === "DROP_SHADOW" || e.type === "INNER_SHADOW"),
  );
  if (!shadows.length) return undefined;
  return shadows
    .map((e) => {
      const inset = e.type === "INNER_SHADOW" ? "inset " : "";
      const ox = round(e.offset?.x ?? 0, 2);
      const oy = round(e.offset?.y ?? 0, 2);
      const blur = round(e.radius ?? 0, 2);
      const spread = round(e.spread ?? 0, 2);
      const col = e.color ? colorToHex(e.color) : "#00000000";
      return `${inset}${ox}px ${oy}px ${blur}px ${spread}px ${col}`;
    })
    .join(", ");
}
