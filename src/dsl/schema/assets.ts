/**
 * The asset contract: what the compiler *asks* for (an `AssetSpec` — "a
 * rounded outline icon of a lock, in the brand colour") and what the asset
 * engine hands back. Deliberately semantic rather than a URL, so the same
 * document resolves differently against different providers.
 */

import { z } from "zod";

// ============================================================================
// Asset references (CONSUMED contract — the compiler emits AssetSpec, the
// asset engine resolves it to a ResolvedAsset whose `assetId` == the inbound
// key that flows onto PdsNode.assetId). Kept here so schema.ts is standalone;
// the canonical AssetKind also lives in src/assets/types.ts and MUST match.
// ============================================================================

export type AssetKind =
  | "icon"
  | "photo"
  | "illustration"
  | "avatar"
  | "pattern"
  | "font"
  | "mockup"
  | "logo"
  | "generated";

export type StyleTag =
  | "flat"
  | "line"
  | "outline"
  | "filled"
  | "duotone"
  | "3d"
  | "photo"
  | "illustration"
  | "hand-drawn"
  | "geometric"
  | "gradient";

export type IconWeight = "thin" | "light" | "regular" | "medium" | "bold";

/** A semantic asset need the compiler hands the asset engine. */
export interface AssetSpec {
  query: string;
  kind?: AssetKind;
  role?:
    | "hero"
    | "nav-logo"
    | "card-image"
    | "avatar"
    | "icon"
    | "background"
    | "section-illustration"
    | "mockup"
    | "brand-logo";
  style?: StyleTag[];
  weight?: IconWeight;
  aspect?: number;
  minWidth?: number;
  /** Brand hexes for recolour. */
  palette?: string[];
  /** Avatars / deterministic generation. */
  seed?: string;
  provider?: string;
  w?: number;
  h?: number;
}

/** What the asset engine returns; `assetId` is the inbound key that lands on
 *  PdsNode.assetId and travels the whole delivery chain. */
export interface ResolvedAsset {
  /** Inbound key: PdsNode.assetId === EmitAsset.ref === GET /asset/:key. */
  assetId?: string;
  /** Inline `d` path for small vectors (icons). */
  vectorPath?: string;
  /** Inline SVG string for sub-8KB SVGs (skip the round-trip). */
  inlineSvg?: string;
  url?: string;
  w?: number;
  h?: number;
  kind: AssetKind;
  scaleMode?: "fill" | "fit" | "stretch" | "crop" | "tile";
}

/** MUST degrade to keyless providers and NEVER throw. */
export interface AssetResolver {
  resolve(spec: AssetSpec): Promise<ResolvedAsset>;
}

/** Optional font-metrics helper for box sizing. */
export interface ResolvedTypeStyle {
  size: number;
  weight: number;
  line: number;
  tracking: number;
  family: string;
}
export interface TextMeasurer {
  measure(
    chars: string,
    style: ResolvedTypeStyle,
    maxWidth?: number,
  ): { w: number; h: number; lines: number };
}

const AssetKindSchema = z.enum([
  "icon",
  "photo",
  "illustration",
  "avatar",
  "pattern",
  "font",
  "mockup",
  "logo",
  "generated",
]);
const StyleTagSchema = z.enum([
  "flat",
  "line",
  "outline",
  "filled",
  "duotone",
  "3d",
  "photo",
  "illustration",
  "hand-drawn",
  "geometric",
  "gradient",
]);
const IconWeightSchema = z.enum(["thin", "light", "regular", "medium", "bold"]);

export const AssetSpecSchema: z.ZodType<AssetSpec> = z.object({
  query: z.string(),
  kind: AssetKindSchema.optional(),
  role: z
    .enum([
      "hero",
      "nav-logo",
      "card-image",
      "avatar",
      "icon",
      "background",
      "section-illustration",
      "mockup",
      "brand-logo",
    ])
    .optional(),
  style: z.array(StyleTagSchema).optional(),
  weight: IconWeightSchema.optional(),
  aspect: z.number().optional(),
  minWidth: z.number().optional(),
  palette: z.array(z.string()).optional(),
  seed: z.string().optional(),
  provider: z.string().optional(),
  w: z.number().optional(),
  h: z.number().optional(),
});

export const AssetSrcSchema = z.union([AssetSpecSchema, z.string()]);
