/**
 * Everything that fills or shadows a node: solid colours, the full gradient
 * and image paint stacks, and the drop/inner/blur effects.
 *
 * The recurring theme is that Figma's representation is lossy the moment you
 * flatten it — a gradient is not its first stop, and an image is not its
 * average colour — so these types keep the whole stack rather than a summary.
 */

export interface GradientStop {
  at: number;
  /** Hex with optional alpha, e.g. "#ff0066" or "#ff006680". */
  color: string;
}

export type GradientKind =
  | "linear-gradient"
  | "radial-gradient"
  | "angular-gradient"
  | "diamond-gradient";

/** Solid colour, with its own alpha. */
export interface SolidFill {
  type: "color";
  color: string;
  /** Layer-level opacity multiplier (0..1). Distinct from `color`'s alpha. */
  opacity?: number;
  /**
   * Figma Variable name bound to this colour (e.g. `"colors/brand/primary"`).
   * When present, prefer `var(--colors-brand-primary)` (or the codebase's
   * equivalent token reference) over the resolved hex — the variable is
   * the design-system intent; the hex is just its current value. Only
   * shipped via the plugin path; REST cannot reliably resolve variable
   * IDs to names.
   */
  var?: string;
}

/** Linear / radial / angular gradient with full stop data — no info loss. */
export interface GradientFill {
  type: GradientKind;
  /** CSS-style angle in degrees, only meaningful for linear gradients. */
  angle?: number;
  stops: GradientStop[];
  opacity?: number;
}

/** Image paint. `assetId` matches the id you'd pass to plumb_assets. */
export interface ImageFill {
  type: "image";
  /** Plumb asset id (Figma node id). Use to tag `data-plumb-asset="<id>"`. */
  assetId?: string;
  /** Figma's CSS-equivalent scale mode. */
  scaleMode?: "fill" | "fit" | "stretch" | "crop" | "tile";
  opacity?: number;
  /**
   * 2×3 affine crop matrix (v0.10+). Present when the user dragged the
   * source image around inside the node — without it, agents render a
   * default-centered crop and the photo lands wrong.
   */
  crop?: number[][];
  /** Image rotation, degrees clockwise (v0.10+). Omitted at 0°. */
  rotation?: number;
  /**
   * Ready-to-paste CSS `filter` value approximating Figma's per-image
   * adjustment sliders (exposure/contrast/saturation → `brightness()`/
   * `contrast()`/`saturate()` — the three that have a clean 1:1 CSS
   * equivalent). Omitted when none of those three are set. Figma's
   * `temperature`/`tint`/`highlights`/`shadows` have no native CSS filter
   * equivalent and are intentionally NOT approximated into this string —
   * approximating those would misrepresent what the CSS actually
   * reproduces; `filtersRaw` below carries them for a consumer that wants
   * the underlying numbers regardless.
   */
  cssFilter?: string;
  /** Raw Figma filter values, roughly -1..1 each, 0/absent = untouched.
   *  Present whenever the source paint had ANY filter set, even ones
   *  `cssFilter` couldn't express. */
  filtersRaw?: {
    exposure?: number;
    contrast?: number;
    saturation?: number;
    temperature?: number;
    tint?: number;
    highlights?: number;
    shadows?: number;
  };
}

export type Fill = SolidFill | GradientFill | ImageFill;

/** Drop or inset CSS shadow. */
export interface ShadowEffect {
  type: "drop-shadow" | "inner-shadow";
  x: number;
  y: number;
  blur: number;
  spread: number;
  color: string;
}

/**
 * Blur effect. `layer-blur` blurs the node itself (CSS `filter: blur()`);
 * `background-blur` blurs the content behind the node (CSS
 * `backdrop-filter: blur()` — that's what makes "frosted glass" panels look
 * the way they do).
 */
export interface BlurEffect {
  type: "layer-blur" | "background-blur";
  radius: number;
}

export type Effect = ShadowEffect | BlurEffect;

/**
 * A prototype transition wired in Figma. Surfaces what the design intends to
 * happen, not what the rendered DOM is doing — pair with CDP Animation
 * inspection if you need runtime verification.
 */
