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

export interface FigmaPaint {
  type: string; // SOLID | GRADIENT_LINEAR | GRADIENT_RADIAL | IMAGE | ...
  visible?: boolean;
  opacity?: number;
  color?: RgbaColor;
}

export interface FigmaEffect {
  type: string; // DROP_SHADOW | INNER_SHADOW | LAYER_BLUR | BACKGROUND_BLUR
  visible?: boolean;
  color?: RgbaColor;
  offset?: { x: number; y: number };
  radius?: number;
  spread?: number;
}

export interface FigmaTypeStyle {
  fontFamily?: string;
  fontWeight?: number;
  fontSize?: number;
  lineHeightPx?: number;
  letterSpacing?: number;
  textAlignHorizontal?: string;
  textCase?: string;
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

  [key: string]: unknown;
}

/** What an ingest source returns: the node tree plus file identity. */
export interface FigmaFileResult {
  document: FigmaNode;
  fileName: string;
  version: string;
}
