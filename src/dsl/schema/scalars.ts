/**
 * Scalar aliases every other DSL module builds on — colours, spacing, radii,
 * sizing, alignment — with their zod validators alongside the types they
 * validate. Nothing here depends on anything else in the DSL, which is what
 * lets the rest of the schema form a clean layer stack on top of it.
 */

import { z } from "zod";

// ============================================================================
// Scalars & shared aliases
// ============================================================================

/** Colour: `"#rrggbb[aa]"` | a `"@role"` brand ref | a Gradient. */
export type Color = string | Gradient;

export interface Gradient {
  kind: "linear" | "radial" | "angular" | "diamond";
  /** Degrees, linear only. */
  angle?: number;
  /** `color` is a hex or a `"@role"` ref; `at` is 0..1. */
  stops: Array<{ at: number; color: string }>;
}

/** px, or a SpacingScale key ("lg"). */
export type Space = number | string;
/** px | "full" | a RadiusScale key. */
export type RadiusTok = number | "full" | string;
/** A ShadowScale key, or a raw CSS box-shadow string. */
export type ShadowTok = string;
/** "hug" | "fill" | px | "50%". */
export type Size = "hug" | "fill" | number | string;

export type Justify = "start" | "center" | "end" | "between";
export type Align = "start" | "center" | "end" | "stretch" | "baseline";
export type SelfAlign = "start" | "center" | "end" | "stretch";

/** One value = all sides; [v,h]; or [t,r,b,l]. */
export type PadSpec = Space | [Space, Space] | [Space, Space, Space, Space];

// ============================================================================
// Zod validators — the prompt->DSL layer parses model output with these
// BEFORE calling compile(). Types above are the source of truth; the schemas
// structurally validate them (recursive Block union via z.lazy).
// ============================================================================

const GradientSchema: z.ZodType<Gradient> = z.object({
  kind: z.enum(["linear", "radial", "angular", "diamond"]),
  angle: z.number().optional(),
  stops: z.array(z.object({ at: z.number(), color: z.string() })),
});

export const ColorSchema: z.ZodType<Color> = z.union([z.string(), GradientSchema]);

export const SpaceSchema = z.union([z.number(), z.string()]);
export const RadiusTokSchema = z.union([z.number(), z.literal("full"), z.string()]);
export const SizeSchema = z.union([z.literal("hug"), z.literal("fill"), z.number(), z.string()]);
export const JustifySchema = z.enum(["start", "center", "end", "between"]);
export const AlignSchema = z.enum(["start", "center", "end", "stretch", "baseline"]);
export const SelfAlignSchema = z.enum(["start", "center", "end", "stretch"]);
export const PadSpecSchema: z.ZodType<PadSpec> = z.union([
  SpaceSchema,
  z.tuple([SpaceSchema, SpaceSchema]),
  z.tuple([SpaceSchema, SpaceSchema, SpaceSchema, SpaceSchema]),
]);
