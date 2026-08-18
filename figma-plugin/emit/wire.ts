/// <reference types="@figma/plugin-typings" />

/**
 * The write-path wire contract — a local mirror of `src/bridge/protocol.ts` §2.
 *
 * Declared here rather than imported because the plugin bundle compiles under
 * its own isolated tsconfig and must not reach into `src/`. That makes these
 * types a duplicate by necessity: they MUST stay in sync with protocol.ts, and
 * a change on either side without the other is a wire break.
 */

/* ------------------------------------------------------------------ */
/* Wire contract (mirror of src/bridge/protocol.ts §2)                 */
/* ------------------------------------------------------------------ */

export interface EmitAsset {
  ref: string;
  ext: "png" | "jpg" | "webp" | "gif" | "svg";
  mime?: string;
  kind: "image" | "svg";
  /** Filled by the UI thread before this frame reaches main. */
  data?: Uint8Array;
  /** Sub-8KB SVGs travel inline and skip the /asset GET. */
  svgInline?: string;
  w?: number;
  h?: number;
}

export interface FontFace {
  family: string;
  style: string;
}

export type EmitNodeType =
  | "frame"
  | "text"
  | "rect"
  | "ellipse"
  | "line"
  | "vector"
  | "instance"
  | "component"
  | "group";

export interface EmitLayout {
  mode: "HORIZONTAL" | "VERTICAL";
  gap?: number;
  gapCross?: number;
  pad: { t: number; r: number; b: number; l: number };
  primary?: "MIN" | "CENTER" | "MAX" | "SPACE_BETWEEN";
  counter?: "MIN" | "CENTER" | "MAX" | "BASELINE";
  wrap?: boolean;
}

export interface EmitChildLayout {
  grow?: number;
  align?: "MIN" | "CENTER" | "MAX" | "STRETCH" | "INHERIT";
  sizingH?: "FIXED" | "HUG" | "FILL";
  sizingV?: "FIXED" | "HUG" | "FILL";
}

export type EmitPaint =
  | {
      type: "SOLID";
      color: { r: number; g: number; b: number };
      opacity?: number;
      boundVar?: string;
    }
  | {
      type: "GRADIENT_LINEAR" | "GRADIENT_RADIAL" | "GRADIENT_ANGULAR" | "GRADIENT_DIAMOND";
      stops: { position: number; color: { r: number; g: number; b: number; a: number } }[];
      transform?: [[number, number, number], [number, number, number]];
      opacity?: number;
    }
  | {
      type: "IMAGE";
      assetRef: string;
      scaleMode?: "FILL" | "FIT" | "CROP" | "TILE";
      opacity?: number;
    };

export type EmitEffect =
  | {
      type: "DROP_SHADOW" | "INNER_SHADOW";
      color: { r: number; g: number; b: number; a: number };
      offset: { x: number; y: number };
      radius: number;
      spread?: number;
    }
  | { type: "LAYER_BLUR" | "BACKGROUND_BLUR"; radius: number };

export interface EmitTextRun {
  start: number;
  end: number;
  font?: FontFace;
  fontSize?: number;
  fills?: EmitPaint[];
  lineHeightPx?: number;
  letterSpacing?: number;
  decoration?: "UNDERLINE" | "STRIKETHROUGH";
}

export interface EmitText {
  characters: string;
  font: FontFace;
  fontSize: number;
  lineHeightPx?: number;
  letterSpacing?: number;
  align?: "LEFT" | "CENTER" | "RIGHT" | "JUSTIFIED";
  decoration?: "UNDERLINE" | "STRIKETHROUGH";
  autoResize?: "NONE" | "HEIGHT" | "WIDTH_AND_HEIGHT" | "TRUNCATE";
  runs?: EmitTextRun[];
}

export interface EmitNode {
  type: EmitNodeType;
  name?: string;
  size: { w: number; h: number };
  pos?: { x: number; y: number };
  absolute?: boolean;
  layout?: EmitLayout;
  child?: EmitChildLayout;
  fills?: EmitPaint[];
  strokes?: EmitPaint[];
  strokeWeight?: number;
  strokeAlign?: "INSIDE" | "OUTSIDE" | "CENTER";
  strokeSides?: { t: number; r: number; b: number; l: number };
  dashPattern?: number[];
  cornerRadius?: number | [number, number, number, number];
  effects?: EmitEffect[];
  opacity?: number;
  clip?: boolean;
  rotation?: number;
  blendMode?: string;
  constraints?: { h?: string; v?: string };
  minWidth?: number;
  maxWidth?: number;
  minHeight?: number;
  maxHeight?: number;
  text?: EmitText;
  vectorPaths?: { data: string; windingRule?: "NONZERO" | "EVENODD" }[];
  instanceOf?: string;
  componentProps?: Record<string, string | boolean | number>;
}

export interface EmitOp {
  key: string;
  parent: string | null;
  node: EmitNode;
}

export type EmitTarget =
  | { kind: "page"; pos?: { x: number; y: number }; pageName?: string }
  | { kind: "into"; nodeId: string }
  | { kind: "replace"; nodeId: string };

export interface EmitPlan {
  planId: string;
  target: EmitTarget;
  mode: "create" | "sync";
  prune?: boolean;
  fonts: FontFace[];
  assets?: EmitAsset[];
  ops: EmitOp[];
  reveal?: boolean;
}

export interface EmitWarning {
  key: string;
  field: string;
  message: string;
}

export interface EmitResult {
  rootId: string;
  rootKey: string;
  created: number;
  updated: number;
  deleted: number;
  ids: Record<string, string>;
  warnings: EmitWarning[];
}

/** Phase heartbeat callback (drives apply-progress + Studio). */
export type ProgressFn = (
  phase: "variables" | "assets" | "nodes" | "layout" | "motion" | "finalize",
  done: number,
  total: number,
  note?: string,
) => void;
