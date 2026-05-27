/**
 * A minimal, permissive subset of the Figma node model — only the fields the
 * Milestone 0 normalizer reads. The REST and (later) plugin ingest sources both
 * produce this shape. Unknown fields are tolerated and ignored.
 */

export interface RgbaColor {
  r: number;
  g: number;
  b: number;
  a?: number;
}

export interface FigmaColorStop {
  position: number;
  color: RgbaColor;
}

export interface FigmaPaint {
  type: string; // SOLID | GRADIENT_LINEAR | GRADIENT_RADIAL | GRADIENT_ANGULAR | GRADIENT_DIAMOND | IMAGE | ...
  visible?: boolean;
  opacity?: number;
  color?: RgbaColor;
  gradientStops?: FigmaColorStop[];
  /** Three handles: [start, end, width-control] in 0..1 of the layer box. */
  gradientHandlePositions?: { x: number; y: number }[];
  /** Asset hash for IMAGE paints. */
  imageRef?: string;
  /** FILL | FIT | CROP | TILE (Figma's enum). */
  scaleMode?: string;
  /**
   * 2×3 affine matrix Figma uses to crop / position an IMAGE paint inside
   * the node box (v0.10 Phase 3). When absent, the image fills via
   * `scaleMode`. When present, agents reconstruct the crop with CSS
   * `transform` on a wrapping `<img>` or by computing the source rect.
   */
  imageTransform?: number[][];
  /** Image rotation in degrees (CSS-shaped, clockwise). */
  rotation?: number;
  /**
   * Resolved Figma Variable name for the paint's COLOR (e.g.
   * `"colors/brand/primary"`). Injected by the plugin path when this paint
   * was bound to a Variable — REST path can't always resolve variable IDs
   * to names, so REST-fetched paints typically won't carry this. Agents
   * should reach for `var(--colors-brand-primary)` instead of the resolved
   * hex when this is present.
   */
  var?: string;
}

export interface FigmaEffect {
  type: string; // DROP_SHADOW | INNER_SHADOW | LAYER_BLUR | BACKGROUND_BLUR
  visible?: boolean;
  color?: RgbaColor;
  offset?: { x: number; y: number };
  radius?: number;
  spread?: number;
}

export interface FigmaTransition {
  type?: string; // SMART_ANIMATE | DISSOLVE | MOVE_IN | PUSH | SLIDE_IN | INSTANT | ...
  duration?: number; // seconds in REST, seconds in plugin too
  easing?: { type?: string; easingFunctionCubicBezier?: number[] };
  // Plugin shape uses snake-case sometimes; REST uses camel.
  easingType?: string;
}

export interface FigmaReaction {
  trigger?: { type?: string }; // ON_CLICK / ON_HOVER / AFTER_TIMEOUT / ...
  action?: {
    type?: string; // NODE | URL | BACK | CLOSE | ...
    destinationId?: string;
    transition?: FigmaTransition;
    // Overlay positioning (v0.10 Phase 3) — only meaningful when the
    // destination is configured as an overlay in Figma. Without these,
    // an agent would default to a centered modal even when the design
    // intends a top-anchored sheet or a custom-position drawer.
    overlayRelativePosition?: { x: number; y: number };
    overlayBackground?: { type: string; color?: RgbaColor };
  };
}

export interface FigmaTypeStyle {
  fontFamily?: string;
  fontWeight?: number;
  fontSize?: number;
  lineHeightPx?: number;
  letterSpacing?: number;
  textAlignHorizontal?: string;
  textCase?: string;
  /** Figma: "NONE" | "UNDERLINE" | "STRIKETHROUGH". */
  textDecoration?: string;
}

export interface FigmaNode {
  id: string;
  name: string;
  type: string;
  visible?: boolean;
  children?: FigmaNode[];
  /**
   * v0.10 Phase 2 — plugin-side depth bound. When the Figma plugin truncates
   * the walk at a requested depth, it omits `children` but still ships
   * `childCount` so the normalizer can emit `more: N` at its boundary
   * without a follow-up call.
   */
  childCount?: number;
  absoluteBoundingBox?: { x: number; y: number; width: number; height: number } | null;

  // Auto-layout
  layoutMode?: "NONE" | "HORIZONTAL" | "VERTICAL";
  layoutPositioning?: "AUTO" | "ABSOLUTE";
  layoutWrap?: "NO_WRAP" | "WRAP";
  itemSpacing?: number;
  counterAxisSpacing?: number;
  paddingTop?: number;
  paddingRight?: number;
  paddingBottom?: number;
  paddingLeft?: number;
  primaryAxisAlignItems?: string;
  counterAxisAlignItems?: string;
  layoutSizingHorizontal?: string;
  layoutSizingVertical?: string;
  /** 0 = no grow, 1 = fill remaining main-axis space. Only meaningful when
   * the parent has auto-layout. */
  layoutGrow?: number;
  /** Cross-axis self-alignment: "INHERIT" | "STRETCH" | "MIN" | "CENTER" | "MAX". */
  layoutAlign?: string;

  // Paint
  fills?: FigmaPaint[];
  strokes?: FigmaPaint[];
  strokeWeight?: number;
  /** "INSIDE" | "OUTSIDE" | "CENTER" — Figma's stroke alignment. */
  strokeAlign?: "INSIDE" | "OUTSIDE" | "CENTER";
  /** REST: `individualStrokeWeights: { top, right, bottom, left }`. */
  individualStrokeWeights?: { top: number; right: number; bottom: number; left: number };
  /** Plugin: per-side stroke weights live as flat fields. */
  strokeTopWeight?: number;
  strokeRightWeight?: number;
  strokeBottomWeight?: number;
  strokeLeftWeight?: number;
  /** Dash lengths in px; empty/missing means a solid stroke. */
  dashPattern?: number[];
  cornerRadius?: number;
  /**
   * Plugin-injected: resolved Figma Variable name bound to `cornerRadius`
   * when present (e.g. `"radii/md"`). REST cannot reliably resolve this.
   */
  cornerRadiusVar?: string;
  rectangleCornerRadii?: [number, number, number, number];
  effects?: FigmaEffect[];
  opacity?: number;
  clipsContent?: boolean;

  // Text
  characters?: string;
  style?: FigmaTypeStyle;
  /**
   * Per-segment styled text (v0.10 Phase 3). Emitted by the plugin via
   * `getStyledTextSegments` when a TEXT node has more than one inline
   * style — a bold word inside a sentence, a coloured link, mixed sizes.
   * Each run carries its own style + optional per-run fills.
   */
  characterRuns?: Array<{
    characters: string;
    style: FigmaTypeStyle;
    fills?: FigmaPaint[];
  }>;

  // Component
  componentId?: string;
  /**
   * INSTANCE-only: the property override values for this instance. Figma
   * shapes them as `{ "PropName#10:0": { value, type } }` where the
   * `#id:idx` suffix is internal. Type can be TEXT | BOOLEAN | VARIANT |
   * INSTANCE_SWAP.
   */
  componentProperties?: Record<string, { value: unknown; type: string }>;

  // Prototyping
  reactions?: FigmaReaction[];

  // Vector geometry — the SVG path data for shape primitives (VECTOR,
  // BOOLEAN_OPERATION, STAR, POLYGON, etc.). REST ships `path`; plugin
  // ships `data` — the plugin normalizes to `path` before sending.
  fillGeometry?: Array<{ path?: string; data?: string; windingRule?: string }>;

  // Variable bindings — map of property name → variable alias (or arrays
  // for fills/strokes). E.g. `boundVariables.fills[0].id` is the variable
  // bound to the first fill's color. The plugin path resolves these to
  // human-readable names and injects them into the paint via `paint.var`.
  boundVariables?: Record<string, unknown>;

  // Mask — `isMask` marks this node as a mask for its subsequent siblings
  // inside the same container. `maskType` is Figma's mask mode and maps to
  // CSS `mask-type` ("alpha" / "luminance") or to vector / outline clipping.
  isMask?: boolean;
  maskType?: "ALPHA" | "LUMINANCE" | "VECTOR" | "GEOMETRY";

  // v0.10 Phase 3 — fidelity additions.
  /** CSS-shaped rotation in degrees. Figma's `rotation` is anti-clockwise;
   * plugin converts to CSS-clockwise before emitting. */
  rotation?: number;
  /** Layer blend mode. "PASS_THROUGH" (default for frames) and "NORMAL"
   * are omitted; anything else (MULTIPLY, OVERLAY, SCREEN, ...) ships. */
  blendMode?: string;
  /** Figma's "Smooth corners" squircle factor, 0..1. */
  cornerSmoothing?: number;
  /** "NONE" | "HEIGHT" | "WIDTH_AND_HEIGHT" | "TRUNCATE" — drives whether
   * the text box grows with content. */
  textAutoResize?: string;
  /** Pinning rules for non-auto-layout children. */
  constraints?: { horizontal?: string; vertical?: string };
  // Per-axis size constraints — meaningful when the parent has auto-layout
  // and the child uses FILL/HUG sizing. A button that hugs content but is
  // pinned to a 120px floor needs `minWidth: 120` or it collapses.
  minWidth?: number;
  maxWidth?: number;
  minHeight?: number;
  maxHeight?: number;
  /** INSTANCE variant selectors, e.g. `{ Size: "md", Style: "primary" }`. */
  variantProperties?: Record<string, string>;

  [key: string]: unknown;
}

/** What an ingest source returns: the node tree plus file identity. */
export interface FigmaFileResult {
  document: FigmaNode;
  fileName: string;
  version: string;
}
