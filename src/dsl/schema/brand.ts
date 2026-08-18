/**
 * Brand tokens — the colour roles, type scale, spacing, radii, and shadows a
 * document is authored against. These lower to the same `TokenTable` that
 * `normalize()` produces from a real Figma file, which is what makes a
 * generated document shape-identical to an extracted one.
 */

import { z } from "zod";
import { type Color, ColorSchema } from "./scalars";

// ============================================================================
// Brand tokens (lower to TokenTable)
// ============================================================================

export interface Brand {
  /** Family names, resolved from TypeStyle.font. */
  fonts?: { heading?: string; body?: string; mono?: string };
  colors: BrandColors;
  type: TypeScale;
  spacing?: SpacingScale;
  radius?: RadiusScale;
  shadow?: ShadowScale;
}

/** Semantic colour roles. Extra roles allowed via index signature. */
export interface BrandColors {
  bg: Color;
  text: Color;
  primary: Color;
  surface?: Color;
  muted?: Color;
  onPrimary?: Color;
  accent?: Color;
  border?: Color;
  [role: string]: Color | undefined;
}

export interface TypeStyle {
  /** px. */
  size: number;
  weight?: number;
  /** unitless line-height. */
  line?: number;
  /** px letter-spacing. */
  tracking?: number;
  /** Resolves via brand.fonts, or a literal family name. */
  font?: "heading" | "body" | "mono" | string;
  color?: Color;
  transform?: "upper" | "lower" | "none";
  decoration?: "underline" | "line-through";
}

export interface TypeScale {
  display?: TypeStyle;
  h1?: TypeStyle;
  h2?: TypeStyle;
  h3?: TypeStyle;
  body?: TypeStyle;
  small?: TypeStyle;
  label?: TypeStyle;
  [name: string]: TypeStyle | undefined;
}

export interface SpacingScale {
  xs?: number;
  sm?: number;
  md?: number;
  lg?: number;
  xl?: number;
  [k: string]: number | undefined;
}
export interface RadiusScale {
  [k: string]: number | "full" | undefined;
}
export interface ShadowSpec {
  x: number;
  y: number;
  blur: number;
  spread: number;
  color: string;
  inset?: boolean;
}
export interface ShadowScale {
  [k: string]: ShadowSpec | undefined;
}

// ---- Brand ----------------------------------------------------------------

export const TypeStyleSchema: z.ZodType<TypeStyle> = z.object({
  size: z.number(),
  weight: z.number().optional(),
  line: z.number().optional(),
  tracking: z.number().optional(),
  font: z.string().optional(),
  color: ColorSchema.optional(),
  transform: z.enum(["upper", "lower", "none"]).optional(),
  decoration: z.enum(["underline", "line-through"]).optional(),
});

const ShadowSpecSchema: z.ZodType<ShadowSpec> = z.object({
  x: z.number(),
  y: z.number(),
  blur: z.number(),
  spread: z.number(),
  color: z.string(),
  inset: z.boolean().optional(),
});

export const BrandSchema: z.ZodType<Brand> = z.object({
  fonts: z
    .object({
      heading: z.string().optional(),
      body: z.string().optional(),
      mono: z.string().optional(),
    })
    .optional(),
  colors: z
    .object({
      bg: ColorSchema,
      text: ColorSchema,
      primary: ColorSchema,
    })
    .catchall(ColorSchema.optional()) as unknown as z.ZodType<BrandColors>,
  type: z.record(z.string(), TypeStyleSchema.optional()) as unknown as z.ZodType<TypeScale>,
  spacing: z.record(z.string(), z.number().optional()).optional() as unknown as z.ZodType<
    SpacingScale | undefined
  >,
  radius: z
    .record(z.string(), z.union([z.number(), z.literal("full")]).optional())
    .optional() as unknown as z.ZodType<RadiusScale | undefined>,
  shadow: z
    .record(z.string(), ShadowSpecSchema.optional())
    .optional() as unknown as z.ZodType<ShadowScale | undefined>,
});
