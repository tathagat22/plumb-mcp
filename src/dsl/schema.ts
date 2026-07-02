/**
 * Plumb Design DSL — the authoritative authoring surface.
 *
 * This is the SINGLE SOURCE OF TRUTH every write-path build agent imports:
 * the semantic language a prompt compiles INTO, which the compiler
 * (src/dsl/compile.ts) then lowers DOWN to the existing PDS IR (src/pds.ts).
 *
 * Two layers:
 *   Layer 1 — semantic Sections (nav / hero / card-grid / features / form /
 *             cta / footer / content / custom) + doc-level Brand tokens +
 *             reusable Components. This is what the prompt targets.
 *   Layer 2 — primitive Blocks (stack / text / image / icon / button / field /
 *             instance / slot / spacer / divider) that map ~1:1 to PdsNode.
 *
 * Sections are SUGAR that expand into Blocks; only Blocks lower to PdsNode.
 * Brand lowers to TokenTable by reusing the existing TokenInterner +
 * HandleMinter, so the emitted PdsDocument is shape-identical to what
 * normalize() produces from Figma (the symmetry payoff).
 *
 * The file exports both the TypeScript interfaces (types the compiler and
 * siblings consume) and the matching zod validators (the prompt->DSL layer
 * validates model output with `DesignDocSchema` before calling compile()).
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

// ============================================================================
// Motion authoring (semantic; compiles to MotionSpec[] on PdsNodes)
// ============================================================================

export type DslTrigger =
  | "click"
  | "hover"
  | "press"
  | "drag"
  | "mouse-enter"
  | "mouse-leave"
  | "mouse-down"
  | "mouse-up"
  | `key:${string}`
  | `after:${number}`;

export type DslEasing =
  | "linear"
  | "ease-in"
  | "ease-out"
  | "ease-in-out"
  | "ease-in-back"
  | "ease-out-back"
  | "ease-in-out-back"
  | "gentle"
  | "quick"
  | "bouncy"
  | "slow"
  | { bezier: [number, number, number, number] }
  | { spring: { mass: number; stiffness: number; damping: number } };

export interface DslTransition {
  kind:
    | "smart"
    | "dissolve"
    | "move-in"
    | "move-out"
    | "push"
    | "slide-in"
    | "slide-out"
    | "scroll-animate"
    | "instant";
  from?: "left" | "right" | "top" | "bottom";
  /** ms, default 300. */
  duration?: number;
  ease?: DslEasing;
  matchLayers?: boolean;
}

/** One interaction on any Block. Exactly one action verb should be set. */
export interface DslInteraction {
  on: DslTrigger;
  go?: string;
  swap?: string;
  overlay?: string;
  scrollTo?: string;
  back?: boolean;
  close?: boolean;
  url?: string;
  set?: Record<string, string | number | boolean>;
  animate?: DslTransition;
  keepScroll?: boolean;
  resetState?: boolean;
}

export interface DslOverlayConfig {
  position?:
    | "center"
    | "top"
    | "bottom"
    | "left"
    | "right"
    | "top-left"
    | "top-right"
    | "bottom-left"
    | "bottom-right"
    | "manual";
  at?: { x: number; y: number };
  backdrop?: string;
  closeOnClickOutside?: boolean;
}

export interface DslPrototype {
  device?: "none" | { preset: string } | { size: { w: number; h: number } };
  rotation?: "portrait" | "landscape";
  background?: string;
  /** Starting screen id; else the first page with `start`. */
  start?: string;
}

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

// ============================================================================
// Components
// ============================================================================

export interface PropDef {
  name: string;
  type: "text" | "number" | "boolean" | "color" | "enum";
  default?: string | number | boolean;
  options?: string[];
}

/** Body strings accept `"@prop.<name>"`; Slot blocks pull from Instance.slots. */
export interface Component {
  name: string;
  props?: PropDef[];
  slots?: string[];
  body: Block;
}

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

// ============================================================================
// Pages & document
// ============================================================================

export interface Page {
  id?: string;
  name: string;
  width?: number;
  height?: number | "auto";
  bg?: Color;
  sections: Section[];
}

export interface DesignDoc {
  version: "1";
  meta?: { name?: string; description?: string };
  brand: Brand;
  components?: Component[];
  pages: Page[];
  prototype?: DslPrototype;
}

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

const ColorSchema: z.ZodType<Color> = z.union([z.string(), GradientSchema]);

const SpaceSchema = z.union([z.number(), z.string()]);
const RadiusTokSchema = z.union([z.number(), z.literal("full"), z.string()]);
const SizeSchema = z.union([z.literal("hug"), z.literal("fill"), z.number(), z.string()]);
const JustifySchema = z.enum(["start", "center", "end", "between"]);
const AlignSchema = z.enum(["start", "center", "end", "stretch", "baseline"]);
const SelfAlignSchema = z.enum(["start", "center", "end", "stretch"]);
const PadSpecSchema: z.ZodType<PadSpec> = z.union([
  SpaceSchema,
  z.tuple([SpaceSchema, SpaceSchema]),
  z.tuple([SpaceSchema, SpaceSchema, SpaceSchema, SpaceSchema]),
]);

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

const AssetSrcSchema = z.union([AssetSpecSchema, z.string()]);

// ---- Brand ----------------------------------------------------------------

const TypeStyleSchema: z.ZodType<TypeStyle> = z.object({
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

const BrandSchema: z.ZodType<Brand> = z.object({
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

// ---- Motion ---------------------------------------------------------------

const DslTriggerSchema = z
  .string()
  .refine(
    (s) =>
      [
        "click",
        "hover",
        "press",
        "drag",
        "mouse-enter",
        "mouse-leave",
        "mouse-down",
        "mouse-up",
      ].includes(s) ||
      /^key:.+$/.test(s) ||
      /^after:\d+$/.test(s),
    { message: "invalid trigger" },
  ) as z.ZodType<DslTrigger>;

const DslEasingSchema: z.ZodType<DslEasing> = z.union([
  z.enum([
    "linear",
    "ease-in",
    "ease-out",
    "ease-in-out",
    "ease-in-back",
    "ease-out-back",
    "ease-in-out-back",
    "gentle",
    "quick",
    "bouncy",
    "slow",
  ]),
  z.object({ bezier: z.tuple([z.number(), z.number(), z.number(), z.number()]) }),
  z.object({
    spring: z.object({ mass: z.number(), stiffness: z.number(), damping: z.number() }),
  }),
]);

const DslTransitionSchema: z.ZodType<DslTransition> = z.object({
  kind: z.enum([
    "smart",
    "dissolve",
    "move-in",
    "move-out",
    "push",
    "slide-in",
    "slide-out",
    "scroll-animate",
    "instant",
  ]),
  from: z.enum(["left", "right", "top", "bottom"]).optional(),
  duration: z.number().optional(),
  ease: DslEasingSchema.optional(),
  matchLayers: z.boolean().optional(),
});

const DslInteractionSchema: z.ZodType<DslInteraction> = z.object({
  on: DslTriggerSchema,
  go: z.string().optional(),
  swap: z.string().optional(),
  overlay: z.string().optional(),
  scrollTo: z.string().optional(),
  back: z.boolean().optional(),
  close: z.boolean().optional(),
  url: z.string().optional(),
  set: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional(),
  animate: DslTransitionSchema.optional(),
  keepScroll: z.boolean().optional(),
  resetState: z.boolean().optional(),
});

const DslOverlayConfigSchema: z.ZodType<DslOverlayConfig> = z.object({
  position: z
    .enum([
      "center",
      "top",
      "bottom",
      "left",
      "right",
      "top-left",
      "top-right",
      "bottom-left",
      "bottom-right",
      "manual",
    ])
    .optional(),
  at: z.object({ x: z.number(), y: z.number() }).optional(),
  backdrop: z.string().optional(),
  closeOnClickOutside: z.boolean().optional(),
});

const DslPrototypeSchema: z.ZodType<DslPrototype> = z.object({
  device: z
    .union([
      z.literal("none"),
      z.object({ preset: z.string() }),
      z.object({ size: z.object({ w: z.number(), h: z.number() }) }),
    ])
    .optional(),
  rotation: z.enum(["portrait", "landscape"]).optional(),
  background: z.string().optional(),
  start: z.string().optional(),
});

// ---- Blocks (recursive) ---------------------------------------------------

const TextRunSchema: z.ZodType<TextRun> = z.object({
  t: z.string(),
  style: z.string().optional(),
  color: ColorSchema.optional(),
  decoration: z.enum(["underline", "line-through"]).optional(),
});
const TextValueSchema: z.ZodType<TextValue> = z.union([z.string(), z.array(TextRunSchema)]);

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
const lazyBlock = z.lazy(() => BlockSchema);
const lazyBlockArray = z.array(lazyBlock);

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

const ImageSchema: z.ZodType<Image> = z.object({
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

const ButtonSchema: z.ZodType<Button> = z.object({
  ...blockBaseShape,
  type: z.literal("button"),
  label: z.string(),
  variant: z.enum(["primary", "secondary", "outline", "ghost", "link"]).optional(),
  size: z.enum(["sm", "md", "lg"]).optional(),
  icon: z.string().optional(),
  iconPos: z.enum(["left", "right"]).optional(),
  href: z.string().optional(),
}) as z.ZodType<Button>;

const FieldSchema: z.ZodType<Field> = z.object({
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

// ---- Components ------------------------------------------------------------

const PropDefSchema: z.ZodType<PropDef> = z.object({
  name: z.string(),
  type: z.enum(["text", "number", "boolean", "color", "enum"]),
  default: z.union([z.string(), z.number(), z.boolean()]).optional(),
  options: z.array(z.string()).optional(),
});

export const ComponentSchema: z.ZodType<Component> = z.object({
  name: z.string(),
  props: z.array(PropDefSchema).optional(),
  slots: z.array(z.string()).optional(),
  body: lazyBlock,
});

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

// ---- Page & document ------------------------------------------------------

export const PageSchema: z.ZodType<Page> = z.object({
  id: z.string().optional(),
  name: z.string(),
  width: z.number().optional(),
  height: z.union([z.number(), z.literal("auto")]).optional(),
  bg: ColorSchema.optional(),
  sections: z.array(SectionSchema),
});

/** The one schema the prompt->DSL layer validates model output against. */
export const DesignDocSchema: z.ZodType<DesignDoc> = z.object({
  version: z.literal("1"),
  meta: z
    .object({ name: z.string().optional(), description: z.string().optional() })
    .optional(),
  brand: BrandSchema,
  components: z.array(ComponentSchema).optional(),
  pages: z.array(PageSchema),
  prototype: DslPrototypeSchema.optional(),
});
