import { clamp01, round } from "../util/num";
import type {
  FigmaColorStop,
  FigmaEffect,
  FigmaPaint,
  FigmaTypeStyle,
  RgbaColor,
} from "../figma/types";
import type {
  Effect,
  Fill,
  GradientFill,
  GradientStop,
  ImageFill,
  SolidFill,
} from "../pds";

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

/**
 * Visible-only filter that also drops paints with zero-effective opacity, so
 * the agent doesn't get fed inert "hidden override" layers as the dominant
 * fill — the dashboard-pill bug from real-world feedback was exactly this.
 */
function visiblePaints(paints: FigmaPaint[] | undefined): FigmaPaint[] {
  if (!paints?.length) return [];
  return paints.filter((p) => p && p.visible !== false && (p.opacity ?? 1) > 0);
}

/* ---------------------------------------------------------------------- */
/* Single-string compact fill                                              */
/* ---------------------------------------------------------------------- */

/** First visible paint → a CSS-ready value. Solid → hex; gradient/image → a marker. */
export function paintToCss(paints: FigmaPaint[] | undefined): string | undefined {
  const list = visiblePaints(paints);
  if (!list.length) return undefined;
  const p = list[0]!;
  if (p.type === "SOLID" && p.color) {
    const a = (p.color.a ?? 1) * (p.opacity ?? 1);
    return colorToHex({ r: p.color.r, g: p.color.g, b: p.color.b, a });
  }
  if (p.type.startsWith("GRADIENT")) return "gradient";
  if (p.type === "IMAGE") return "image";
  return undefined;
}

/* ---------------------------------------------------------------------- */
/* Structured fill stack                                                   */
/* ---------------------------------------------------------------------- */

const GRADIENT_KIND: Record<string, GradientFill["type"]> = {
  GRADIENT_LINEAR: "linear-gradient",
  GRADIENT_RADIAL: "radial-gradient",
  GRADIENT_ANGULAR: "angular-gradient",
  GRADIENT_DIAMOND: "diamond-gradient",
};

const SCALE_MODE: Record<string, NonNullable<ImageFill["scaleMode"]>> = {
  FILL: "fill",
  FIT: "fit",
  STRETCH: "stretch",
  CROP: "crop",
  TILE: "tile",
};

/**
 * Linear-gradient angle from Figma's three handle positions. Handle 0 is the
 * start, handle 1 is the end — the line between them is the gradient axis.
 * Returns CSS-style degrees (0 = pointing up, increasing clockwise, like
 * `linear-gradient(<deg>, ...)`).
 */
function gradientAngle(
  handles: { x: number; y: number }[] | undefined,
): number | undefined {
  if (!handles || handles.length < 2) return undefined;
  const [a, b] = handles;
  if (!a || !b) return undefined;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  if (dx === 0 && dy === 0) return undefined;
  // atan2 returns radians from positive x; CSS gradient angle has 0 = "up"
  // (negative y) and grows clockwise. Convert:
  let deg = (Math.atan2(dy, dx) * 180) / Math.PI + 90;
  if (deg < 0) deg += 360;
  if (deg >= 360) deg -= 360;
  return round(deg, 1);
}

function stopFor(s: FigmaColorStop): GradientStop {
  return { at: round(s.position, 4), color: colorToHex(s.color) };
}

function fillOf(p: FigmaPaint): Fill | undefined {
  if (p.type === "SOLID" && p.color) {
    const out: SolidFill = {
      type: "color",
      color: colorToHex({ r: p.color.r, g: p.color.g, b: p.color.b, a: p.color.a ?? 1 }),
    };
    if (p.opacity !== undefined && p.opacity < 1) out.opacity = round(p.opacity, 2);
    return out;
  }
  const grad = GRADIENT_KIND[p.type];
  if (grad) {
    const out: GradientFill = {
      type: grad,
      stops: (p.gradientStops ?? []).map(stopFor),
    };
    if (grad === "linear-gradient") {
      const ang = gradientAngle(p.gradientHandlePositions);
      if (ang !== undefined) out.angle = ang;
    }
    if (p.opacity !== undefined && p.opacity < 1) out.opacity = round(p.opacity, 2);
    return out;
  }
  if (p.type === "IMAGE") {
    const out: ImageFill = { type: "image" };
    if (p.imageRef) out.assetId = p.imageRef;
    if (p.scaleMode && SCALE_MODE[p.scaleMode]) out.scaleMode = SCALE_MODE[p.scaleMode];
    if (p.opacity !== undefined && p.opacity < 1) out.opacity = round(p.opacity, 2);
    return out;
  }
  return undefined;
}

/**
 * Build the full fill stack, bottom-up (Figma's array order). Returns
 * undefined when there's nothing visible, or when the stack is exactly one
 * SOLID — in that trivial case the compact `fill` token-ref is enough on its
 * own and the array would be redundant noise.
 */
export function paintsToFillStack(paints: FigmaPaint[] | undefined): Fill[] | undefined {
  const list = visiblePaints(paints);
  if (!list.length) return undefined;
  // Trivial case: a single SOLID is fully captured by the compact `fill`
  // field. Don't echo it.
  if (list.length === 1 && list[0]!.type === "SOLID") return undefined;
  const out: Fill[] = [];
  for (const p of list) {
    const f = fillOf(p);
    if (f) out.push(f);
  }
  return out.length ? out : undefined;
}

/* ---------------------------------------------------------------------- */
/* Type style                                                              */
/* ---------------------------------------------------------------------- */

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

/* ---------------------------------------------------------------------- */
/* Effects — compact and stack                                             */
/* ---------------------------------------------------------------------- */

function visibleEffects(effects: FigmaEffect[] | undefined): FigmaEffect[] {
  if (!effects?.length) return [];
  return effects.filter((e) => e && e.visible !== false);
}

/** Drop-shadow / inner-shadow effects → a CSS box-shadow string. */
export function effectsToCss(effects: FigmaEffect[] | undefined): string | undefined {
  const shadows = visibleEffects(effects).filter(
    (e) => e.type === "DROP_SHADOW" || e.type === "INNER_SHADOW",
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

/**
 * Build the structured effect stack. Returns undefined when there's only a
 * single shadow (already captured by the compact `shadow` string) and nothing
 * else — same dedup logic as fills.
 */
export function effectsToStack(effects: FigmaEffect[] | undefined): Effect[] | undefined {
  const list = visibleEffects(effects);
  if (!list.length) return undefined;
  const onlyShadow =
    list.length === 1 && (list[0]!.type === "DROP_SHADOW" || list[0]!.type === "INNER_SHADOW");
  if (onlyShadow) return undefined;
  const out: Effect[] = [];
  for (const e of list) {
    if (e.type === "DROP_SHADOW" || e.type === "INNER_SHADOW") {
      out.push({
        type: e.type === "DROP_SHADOW" ? "drop-shadow" : "inner-shadow",
        x: round(e.offset?.x ?? 0, 2),
        y: round(e.offset?.y ?? 0, 2),
        blur: round(e.radius ?? 0, 2),
        spread: round(e.spread ?? 0, 2),
        color: e.color ? colorToHex(e.color) : "#00000000",
      });
    } else if (e.type === "LAYER_BLUR") {
      out.push({ type: "layer-blur", radius: round(e.radius ?? 0, 2) });
    } else if (e.type === "BACKGROUND_BLUR") {
      out.push({ type: "background-blur", radius: round(e.radius ?? 0, 2) });
    }
  }
  return out.length ? out : undefined;
}

/** Ready-to-paste CSS `backdrop-filter` value, or undefined. */
export function backdropFilterCss(effects: FigmaEffect[] | undefined): string | undefined {
  const list = visibleEffects(effects);
  const bb = list.find((e) => e.type === "BACKGROUND_BLUR");
  if (!bb) return undefined;
  return `blur(${round(bb.radius ?? 0, 2)}px)`;
}
