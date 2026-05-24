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

  // Paint
  fills?: FigmaPaint[];
  strokes?: FigmaPaint[];
  strokeWeight?: number;
  cornerRadius?: number;
  rectangleCornerRadii?: [number, number, number, number];
  effects?: FigmaEffect[];
  opacity?: number;
  clipsContent?: boolean;

  // Text
  characters?: string;
  style?: FigmaTypeStyle;

  // Component
  componentId?: string;

  // Prototyping
  reactions?: FigmaReaction[];

  [key: string]: unknown;
}

/** What an ingest source returns: the node tree plus file identity. */
export interface FigmaFileResult {
  document: FigmaNode;
  fileName: string;
  version: string;
}
