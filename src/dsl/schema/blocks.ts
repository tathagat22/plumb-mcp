/**
 * Layer 2 — the primitive blocks (stack / text / image / icon / button /
 * field / instance / slot / spacer / divider) that map ~1:1 onto `PdsNode`.
 * Sections are sugar; only blocks lower.
 *
 * The block union is recursive, so its validator goes through `z.lazy`;
 * `lazyBlock` / `lazyBlockArray` are shared with the section schemas so the
 * recursion has exactly one definition.
 */

import { z } from "zod";
import { type AssetSpec, AssetSrcSchema } from "./assets";
import { type TypeStyle, TypeStyleSchema } from "./brand";
import { type DslInteraction, DslInteractionSchema } from "./motion";
import {
  type Align,
  AlignSchema,
  type Color,
  ColorSchema,
  type Justify,
  JustifySchema,
  type PadSpec,
  PadSpecSchema,
  type RadiusTok,
  RadiusTokSchema,
  type SelfAlign,
  SelfAlignSchema,
  type ShadowTok,
  type Size,
  SizeSchema,
  type Space,
  SpaceSchema,
} from "./scalars";

// ============================================================================
// Blocks (Layer 2 — primitives)
// ============================================================================

export type Block =
  | Stack
  | Text
  | Image
  | Icon
  | Button
  | Field
  | Instance
  | Slot
  | Spacer
  | Divider;

export type TextValue = string | TextRun[];
export interface TextRun {
  t: string;
  style?: string;
  color?: Color;
  decoration?: "underline" | "line-through";
}

/** CSS `mix-blend-mode` (maps 1:1 to Figma's `blendMode`, uppercased/`-`→`_`). */
export type MixBlendMode =
  | "normal"
  | "multiply"
  | "screen"
  | "overlay"
  | "darken"
  | "lighten"
  | "color-dodge"
  | "color-burn"
  | "hard-light"
  | "soft-light"
  | "difference"
  | "exclusion"
  | "hue"
  | "saturation"
  | "color"
  | "luminosity";

export interface BorderSpec {
  color: Color;
  width: number;
  align?: "inside" | "outside" | "center";
  dash?: number[];
}

export interface BlockBase {
  /** Seeds the `el` handle. */
  id?: string;
  /** Figma layer name. */
  name?: string;
  w?: Size;
  h?: Size;
  grow?: number;
  self?: SelfAlign;
  bg?: Color;
  border?: BorderSpec;
  radius?: RadiusTok;
  shadow?: ShadowTok;
  opacity?: number;
  pad?: PadSpec;
  clip?: boolean;
  /** Absolute-position escape hatch. */
  pos?: { x: number; y: number };
  /** CSS `mix-blend-mode` — layers this node onto what's beneath it. */
  blend?: MixBlendMode;
  /**
   * Background (frosted-glass) blur radius in px behind this node — the
   * "glass panel" material. Combined with `shadow` when both are set (both
   * ship in the same effect stack); a raw CSS `shadow` string can't be
   * losslessly combined and is dropped in favor of the blur in that case.
   */
  blur?: number;
  /** Semantic interactions (compile to MotionSpec[]). */
  interactions?: DslInteraction[];
}

export interface Stack extends BlockBase {
  type: "stack";
  dir?: "row" | "col";
  gap?: Space;
  gapCross?: Space;
  justify?: Justify;
  align?: Align;
  wrap?: boolean;
  children: Block[];
}

export interface Text extends BlockBase {
  type: "text";
  text: TextValue;
  style?: string | TypeStyle;
  color?: Color;
  textAlign?: "left" | "center" | "right" | "justify";
  maxLines?: number;
  resize?: "h" | "wh" | "trunc";
}

export interface Image extends BlockBase {
  type: "image";
  src: AssetSpec | string;
  fit?: "fill" | "fit" | "stretch" | "crop" | "tile";
  alt?: string;
}

export interface Icon extends BlockBase {
  type: "icon";
  /** Iconify query. */
  name: string;
  size?: number;
  color?: Color;
}

export interface Button extends BlockBase {
  type: "button";
  label: string;
  variant?: "primary" | "secondary" | "outline" | "ghost" | "link";
  size?: "sm" | "md" | "lg";
  icon?: string;
  iconPos?: "left" | "right";
  href?: string;
}

export interface Field extends BlockBase {
  type: "field";
  kind?: "text" | "email" | "password" | "textarea" | "select" | "checkbox";
  label?: string;
  placeholder?: string;
}

export interface Instance extends BlockBase {
  type: "instance";
  component: string;
  props?: Record<string, string | number | boolean>;
  slots?: Record<string, Block[]>;
}

export interface Slot extends BlockBase {
  type: "slot";
  name: string;
}

export interface Spacer extends BlockBase {
  type: "spacer";
  size?: Space;
}

export interface Divider extends BlockBase {
  type: "divider";
}

// ---- Blocks (recursive) ---------------------------------------------------

const TextRunSchema: z.ZodType<TextRun> = z.object({
  t: z.string(),
  style: z.string().optional(),
  color: ColorSchema.optional(),
  decoration: z.enum(["underline", "line-through"]).optional(),
});
export const TextValueSchema: z.ZodType<TextValue> = z.union([z.string(), z.array(TextRunSchema)]);

const BorderSpecSchema: z.ZodType<BorderSpec> = z.object({
  color: ColorSchema,
  width: z.number(),
  align: z.enum(["inside", "outside", "center"]).optional(),
  dash: z.array(z.number()).optional(),
});

/** Shared BlockBase fields, spread into every block schema. */
const blockBaseShape = {
  id: z.string().optional(),
  name: z.string().optional(),
  w: SizeSchema.optional(),
  h: SizeSchema.optional(),
  grow: z.number().optional(),
  self: SelfAlignSchema.optional(),
  bg: ColorSchema.optional(),
  border: BorderSpecSchema.optional(),
  radius: RadiusTokSchema.optional(),
  shadow: z.string().optional(),
  opacity: z.number().optional(),
  pad: PadSpecSchema.optional(),
  clip: z.boolean().optional(),
  pos: z.object({ x: z.number(), y: z.number() }).optional(),
  blend: z
    .enum([
      "normal",
      "multiply",
      "screen",
      "overlay",
      "darken",
      "lighten",
      "color-dodge",
      "color-burn",
      "hard-light",
      "soft-light",
      "difference",
      "exclusion",
      "hue",
      "saturation",
      "color",
      "luminosity",
    ])
    .optional(),
  blur: z.number().optional(),
  interactions: z.array(DslInteractionSchema).optional(),
};

// Forward declaration for recursion.
// eslint-disable-next-line prefer-const
let BlockSchema: z.ZodType<Block>;
export const lazyBlock = z.lazy(() => BlockSchema);
export const lazyBlockArray = z.array(lazyBlock);

const StackSchema: z.ZodType<Stack> = z.object({
  ...blockBaseShape,
  type: z.literal("stack"),
  dir: z.enum(["row", "col"]).optional(),
  gap: SpaceSchema.optional(),
  gapCross: SpaceSchema.optional(),
  justify: JustifySchema.optional(),
  align: AlignSchema.optional(),
  wrap: z.boolean().optional(),
  children: lazyBlockArray,
}) as z.ZodType<Stack>;

const TextSchema: z.ZodType<Text> = z.object({
  ...blockBaseShape,
  type: z.literal("text"),
  text: TextValueSchema,
  style: z.union([z.string(), TypeStyleSchema]).optional(),
  color: ColorSchema.optional(),
  textAlign: z.enum(["left", "center", "right", "justify"]).optional(),
  maxLines: z.number().optional(),
  resize: z.enum(["h", "wh", "trunc"]).optional(),
}) as z.ZodType<Text>;

export const ImageSchema: z.ZodType<Image> = z.object({
  ...blockBaseShape,
  type: z.literal("image"),
  src: AssetSrcSchema,
  fit: z.enum(["fill", "fit", "stretch", "crop", "tile"]).optional(),
  alt: z.string().optional(),
}) as z.ZodType<Image>;

const IconSchema: z.ZodType<Icon> = z.object({
  ...blockBaseShape,
  type: z.literal("icon"),
  name: z.string(),
  size: z.number().optional(),
  color: ColorSchema.optional(),
}) as z.ZodType<Icon>;

export const ButtonSchema: z.ZodType<Button> = z.object({
  ...blockBaseShape,
  type: z.literal("button"),
  label: z.string(),
  variant: z.enum(["primary", "secondary", "outline", "ghost", "link"]).optional(),
  size: z.enum(["sm", "md", "lg"]).optional(),
  icon: z.string().optional(),
  iconPos: z.enum(["left", "right"]).optional(),
  href: z.string().optional(),
}) as z.ZodType<Button>;

export const FieldSchema: z.ZodType<Field> = z.object({
  ...blockBaseShape,
  type: z.literal("field"),
  kind: z.enum(["text", "email", "password", "textarea", "select", "checkbox"]).optional(),
  label: z.string().optional(),
  placeholder: z.string().optional(),
}) as z.ZodType<Field>;

const InstanceSchema: z.ZodType<Instance> = z.object({
  ...blockBaseShape,
  type: z.literal("instance"),
  component: z.string(),
  props: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional(),
  slots: z.record(z.string(), lazyBlockArray).optional(),
}) as z.ZodType<Instance>;

const SlotSchema: z.ZodType<Slot> = z.object({
  ...blockBaseShape,
  type: z.literal("slot"),
  name: z.string(),
}) as z.ZodType<Slot>;

const SpacerSchema: z.ZodType<Spacer> = z.object({
  ...blockBaseShape,
  type: z.literal("spacer"),
  size: SpaceSchema.optional(),
}) as z.ZodType<Spacer>;

const DividerSchema: z.ZodType<Divider> = z.object({
  ...blockBaseShape,
  type: z.literal("divider"),
}) as z.ZodType<Divider>;

BlockSchema = z.discriminatedUnion("type", [
  StackSchema as unknown as z.ZodDiscriminatedUnionOption<"type">,
  TextSchema as unknown as z.ZodDiscriminatedUnionOption<"type">,
  ImageSchema as unknown as z.ZodDiscriminatedUnionOption<"type">,
  IconSchema as unknown as z.ZodDiscriminatedUnionOption<"type">,
  ButtonSchema as unknown as z.ZodDiscriminatedUnionOption<"type">,
  FieldSchema as unknown as z.ZodDiscriminatedUnionOption<"type">,
  InstanceSchema as unknown as z.ZodDiscriminatedUnionOption<"type">,
  SlotSchema as unknown as z.ZodDiscriminatedUnionOption<"type">,
  SpacerSchema as unknown as z.ZodDiscriminatedUnionOption<"type">,
  DividerSchema as unknown as z.ZodDiscriminatedUnionOption<"type">,
]) as unknown as z.ZodType<Block>;

export { BlockSchema };
