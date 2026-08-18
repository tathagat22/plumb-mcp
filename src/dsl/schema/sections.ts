/**
 * Layer 1 — the semantic sections a prompt actually targets (nav / hero /
 * card-grid / features / form / cta / footer / content / custom). Each is
 * sugar that expands into blocks during compilation.
 */

import { z } from "zod";
import { type AssetSpec, AssetSrcSchema } from "./assets";
import {
  type Block,
  type Button,
  ButtonSchema,
  type Field,
  FieldSchema,
  type Image,
  ImageSchema,
  lazyBlock,
  lazyBlockArray,
  type TextValue,
  TextValueSchema,
} from "./blocks";
import { type DslOverlayConfig, DslOverlayConfigSchema } from "./motion";
import {
  type Align,
  AlignSchema,
  type Color,
  ColorSchema,
  type Justify,
  JustifySchema,
  type PadSpec,
  PadSpecSchema,
  type Space,
  SpaceSchema,
} from "./scalars";

// ============================================================================
// Sections (Layer 1 — semantic sugar)
// ============================================================================

export interface Link {
  label: string;
  href?: string;
}
export interface Card {
  icon?: string;
  image?: AssetSpec | string;
  title: string;
  body?: string;
  action?: Button;
}
export interface FooterColumn {
  title: string;
  links: Link[];
}

export interface SectionBase {
  id?: string;
  role: string;
  bg?: Color;
  pad?: PadSpec;
  gap?: Space;
  /** Centred content container width. */
  maxWidth?: number;
  /** Content runs edge-to-edge: horizontal pad → 0, `maxWidth` clamp skipped. */
  bleed?: boolean;
  align?: Align;
  justify?: Justify;
  /** Flips text roles. */
  theme?: "light" | "dark";
  /** Flow entry point when this section is a full screen. */
  start?: boolean | { name: string };
  /** Presentation when opened as an overlay (destination-owned). */
  overlay?: DslOverlayConfig;
  /** Per-frame scroll. */
  scroll?: "none" | "vertical" | "horizontal" | "both";
}

export interface NavSection extends SectionBase {
  role: "nav";
  brand?: { logo?: AssetSpec | string; text?: string };
  links: Link[];
  actions?: Button[];
  sticky?: boolean;
}
export interface HeroSection extends SectionBase {
  role: "hero";
  eyebrow?: string;
  headline: TextValue;
  sub?: string;
  actions?: Button[];
  media?: Image;
  layout?: "center" | "split-left" | "split-right";
}
export interface CardGridSection extends SectionBase {
  role: "card-grid";
  heading?: string;
  columns?: number;
  /** Per-column grow weights (e.g. `[2,1]` for a wide-left/narrow-right grid).
   *  Cycles per row; defaults to equal columns when omitted. */
  columnRatios?: number[];
  cards: Card[];
}
export interface FeaturesSection extends SectionBase {
  role: "features";
  heading?: string;
  features: Card[];
  layout?: "row" | "alternating";
  /** Per-column grow weights for `layout: "row"` (ignored by "alternating",
   *  which is already asymmetric text/media). */
  columnRatios?: number[];
}
export interface FormSection extends SectionBase {
  role: "form";
  heading?: string;
  fields: Field[];
  submit: Button;
}
export interface CtaSection extends SectionBase {
  role: "cta";
  headline: TextValue;
  sub?: string;
  actions: Button[];
}
export interface FooterSection extends SectionBase {
  role: "footer";
  brand?: { logo?: AssetSpec | string; text?: string };
  columns?: FooterColumn[];
  legal?: string;
}
export interface ContentSection extends SectionBase {
  role: "content";
  children: Block[];
}
export interface CustomSection extends SectionBase {
  role: "custom";
  root: Block;
}

export type Section =
  | NavSection
  | HeroSection
  | CardGridSection
  | FeaturesSection
  | FormSection
  | CtaSection
  | FooterSection
  | ContentSection
  | CustomSection;

// ---- Sections -------------------------------------------------------------

const LinkSchema: z.ZodType<Link> = z.object({
  label: z.string(),
  href: z.string().optional(),
});
const CardSchema: z.ZodType<Card> = z.object({
  icon: z.string().optional(),
  image: AssetSrcSchema.optional(),
  title: z.string(),
  body: z.string().optional(),
  action: z.lazy(() => ButtonSchema).optional() as z.ZodType<Button | undefined>,
}) as z.ZodType<Card>;
const FooterColumnSchema: z.ZodType<FooterColumn> = z.object({
  title: z.string(),
  links: z.array(LinkSchema),
});

const sectionBaseShape = {
  id: z.string().optional(),
  bg: ColorSchema.optional(),
  pad: PadSpecSchema.optional(),
  gap: SpaceSchema.optional(),
  maxWidth: z.number().optional(),
  bleed: z.boolean().optional(),
  align: AlignSchema.optional(),
  justify: JustifySchema.optional(),
  theme: z.enum(["light", "dark"]).optional(),
  start: z.union([z.boolean(), z.object({ name: z.string() })]).optional(),
  overlay: DslOverlayConfigSchema.optional(),
  scroll: z.enum(["none", "vertical", "horizontal", "both"]).optional(),
};

const brandBlockSchema = z
  .object({ logo: AssetSrcSchema.optional(), text: z.string().optional() })
  .optional();

const NavSectionSchema = z.object({
  ...sectionBaseShape,
  role: z.literal("nav"),
  brand: brandBlockSchema,
  links: z.array(LinkSchema),
  actions: z.array(ButtonSchema).optional(),
  sticky: z.boolean().optional(),
});
const HeroSectionSchema = z.object({
  ...sectionBaseShape,
  role: z.literal("hero"),
  eyebrow: z.string().optional(),
  headline: TextValueSchema,
  sub: z.string().optional(),
  actions: z.array(ButtonSchema).optional(),
  media: ImageSchema.optional(),
  layout: z.enum(["center", "split-left", "split-right"]).optional(),
});
const CardGridSectionSchema = z.object({
  ...sectionBaseShape,
  role: z.literal("card-grid"),
  heading: z.string().optional(),
  columns: z.number().optional(),
  columnRatios: z.array(z.number()).optional(),
  cards: z.array(CardSchema),
});
const FeaturesSectionSchema = z.object({
  ...sectionBaseShape,
  role: z.literal("features"),
  heading: z.string().optional(),
  features: z.array(CardSchema),
  layout: z.enum(["row", "alternating"]).optional(),
  columnRatios: z.array(z.number()).optional(),
});
const FormSectionSchema = z.object({
  ...sectionBaseShape,
  role: z.literal("form"),
  heading: z.string().optional(),
  fields: z.array(FieldSchema),
  submit: ButtonSchema,
});
const CtaSectionSchema = z.object({
  ...sectionBaseShape,
  role: z.literal("cta"),
  headline: TextValueSchema,
  sub: z.string().optional(),
  actions: z.array(ButtonSchema),
});
const FooterSectionSchema = z.object({
  ...sectionBaseShape,
  role: z.literal("footer"),
  brand: brandBlockSchema,
  columns: z.array(FooterColumnSchema).optional(),
  legal: z.string().optional(),
});
const ContentSectionSchema = z.object({
  ...sectionBaseShape,
  role: z.literal("content"),
  children: lazyBlockArray,
});
const CustomSectionSchema = z.object({
  ...sectionBaseShape,
  role: z.literal("custom"),
  root: lazyBlock,
});

export const SectionSchema: z.ZodType<Section> = z.discriminatedUnion("role", [
  NavSectionSchema as unknown as z.ZodDiscriminatedUnionOption<"role">,
  HeroSectionSchema as unknown as z.ZodDiscriminatedUnionOption<"role">,
  CardGridSectionSchema as unknown as z.ZodDiscriminatedUnionOption<"role">,
  FeaturesSectionSchema as unknown as z.ZodDiscriminatedUnionOption<"role">,
  FormSectionSchema as unknown as z.ZodDiscriminatedUnionOption<"role">,
  CtaSectionSchema as unknown as z.ZodDiscriminatedUnionOption<"role">,
  FooterSectionSchema as unknown as z.ZodDiscriminatedUnionOption<"role">,
  ContentSectionSchema as unknown as z.ZodDiscriminatedUnionOption<"role">,
  CustomSectionSchema as unknown as z.ZodDiscriminatedUnionOption<"role">,
]) as unknown as z.ZodType<Section>;
