import type { FigmaNode } from "../figma/types";

/** Localhost ports the bridge tries to bind, and the plugin scans to find it. */
export const BRIDGE_PORTS = [
  31337, 31338, 31339, 31340, 31341, 31342, 31343, 31344, 31345, 31346,
];

/** One screen (top-level frame) in the file inventory. */
export interface InventoryFrame {
  id: string;
  name: string;
  w: number;
  h: number;
}

export interface InventoryPage {
  id: string;
  name: string;
  frames: InventoryFrame[];
}

/** One match returned from plumb_search. */
export interface SearchMatch {
  id: string;
  name: string;
  type: string;
  page: string;
  w: number;
  h: number;
  parentName?: string;
}

/** One component definition. */
export interface ComponentInfo {
  id: string;
  name: string;
  description?: string;
  page: string;
  w: number;
  h: number;
  instanceCount: number;
}

/** One instance usage of a component. */
export interface InstanceInfo {
  id: string;
  name: string;
  componentId: string;
  page: string;
  overrides?: string[];
}

/** An exported asset. Bytes ride the binary HTTP upload channel; this
 *  manifest entry just carries metadata and the on-disk temp path the bridge
 *  wrote. `path` is null in `list: true` mode (no bytes shipped). */
export interface WireAsset {
  id: string;
  name: string;
  format: "SVG" | "PNG" | "JPG" | "GIF" | "WEBP";
  path: string | null;
  /** The id of the nearest ancestor that was also exported — lets the agent
   *  navigate the asset hierarchy (e.g. "this icon is inside that header"). */
  parentId?: string;
}

// ============================================================================
// WRITE DIRECTION — emit / foundations / motion wire contract (blueprint §2).
// These interfaces are the shared server↔plugin contract; the plugin mirrors
// them locally (figma-plugin/emit.ts, foundations.ts, motion-emit.ts) because
// the plugin bundle cannot import from src/. Keep the two in sync.
// ============================================================================

/** Inbound asset — bytes live at GET /asset/:ref.:ext on the bridge. */
export interface EmitAsset {
  /** Plan-local id; equals PdsNode.assetId. GET /asset/<ref>.<ext>. */
  ref: string;
  ext: "png" | "jpg" | "webp" | "gif" | "svg";
  mime?: string;
  /** image → figma.createImage(bytes); svg → figma.createNodeFromSvg(text). */
  kind: "image" | "svg";
  /** Filled by the UI thread before forwarding to main; ABSENT on the WS wire. */
  data?: Uint8Array;
  /** Sub-8KB SVGs travel inline and skip the /asset GET. */
  svgInline?: string;
  w?: number;
  h?: number;
}

export interface FontFace {
  family: string;
  /** e.g. "Regular", "Bold", "Semi Bold". */
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
  /** authored el (op.key) → Figma node id (== nodeMap == elMap). */
  ids: Record<string, string>;
  warnings: EmitWarning[];
}

// ---- Foundations (Variables / text / effect / grid styles) -----------------
export type VarValue = { hex: string } | { number: number } | { alias: string };
export interface VarSpec {
  name: string;
  type: "COLOR" | "FLOAT";
  values: Record<string, VarValue>;
  scopes?: string[];
}
export interface VarCollectionSpec {
  name: string;
  modes: string[];
  variables: VarSpec[];
}
export interface TextStyleSpec {
  name: string;
  family: string;
  weight: number;
  sizePx: number;
  lineHeightPercent?: number;
  letterSpacingPx?: number;
  textCase?: "ORIGINAL" | "UPPER";
  boundVars?: { fontSize?: string; lineHeight?: string };
}
export interface ShadowEffectWire {
  type: "drop-shadow" | "inner-shadow";
  x: number;
  y: number;
  blur: number;
  spread: number;
  color: string;
}
export interface EffectStyleSpec {
  name: string;
  effects: ShadowEffectWire[];
}
export interface GridStyleSpec {
  name: string;
  pattern: "COLUMNS" | "GRID" | "ROWS";
  count?: number;
  gutterPx?: number;
  marginPx?: number;
  sectionSizePx?: number;
  alignment?: "STRETCH" | "CENTER" | "MIN" | "MAX";
}
export interface FoundationsPlan {
  collections: VarCollectionSpec[];
  textStyles: TextStyleSpec[];
  effectStyles: EffectStyleSpec[];
  gridStyles: GridStyleSpec[];
}
export interface FoundationsResult {
  collections: {
    name: string;
    id: string;
    modeIds: Record<string, string>;
    variableIds: Record<string, string>;
  }[];
  textStyleIds: Record<string, string>;
  effectStyleIds: Record<string, string>;
  gridStyleIds: Record<string, string>;
  warnings: string[];
}

// ---- Motion (prototype reactions / flow starts / device / scroll) ----------
export interface WireSpec {
  trigger:
    | "ON_CLICK"
    | "ON_HOVER"
    | "ON_PRESS"
    | "ON_DRAG"
    | "MOUSE_ENTER"
    | "MOUSE_LEAVE"
    | "MOUSE_UP"
    | "MOUSE_DOWN"
    | "AFTER_TIMEOUT"
    | "ON_KEY_DOWN";
  navigation:
    | "NAVIGATE"
    | "SWAP"
    | "OVERLAY"
    | "SCROLL_TO"
    | "BACK"
    | "CLOSE"
    | "URL"
    | "SET_VAR";
  target?: string;
  kind?:
    | "SMART_ANIMATE"
    | "DISSOLVE"
    | "MOVE_IN"
    | "MOVE_OUT"
    | "PUSH"
    | "SLIDE_IN"
    | "SLIDE_OUT"
    | "SCROLL_ANIMATE"
    | "INSTANT";
  direction?: "LEFT" | "RIGHT" | "TOP" | "BOTTOM";
  durationMs?: number;
  easing?: string;
  matchLayers?: boolean;
  timeoutMs?: number;
  keys?: number[];
  url?: string;
  setVars?: Record<string, string | number | boolean>;
  preserveScroll?: boolean;
  resetState?: boolean;
}
export interface WireBinding {
  sourceEl: string;
  specs: WireSpec[];
}
export interface WireOverlay {
  position:
    | "CENTER"
    | "TOP_LEFT"
    | "TOP_CENTER"
    | "TOP_RIGHT"
    | "BOTTOM_LEFT"
    | "BOTTOM_CENTER"
    | "BOTTOM_RIGHT"
    | "MANUAL";
  at?: { x: number; y: number };
  backdrop?: string;
  closeOnClickOutside?: boolean;
}
export interface WireFrame {
  el: string;
  overflow?: "NONE" | "HORIZONTAL" | "VERTICAL" | "BOTH";
  overlay?: WireOverlay;
}
export interface WirePrototype {
  starts: { el: string; name: string }[];
  device?: {
    kind: "none" | "preset" | "custom";
    preset?: string;
    size?: { w: number; h: number };
    rotation?: "NONE" | "CW_90";
  };
  background?: string;
}
export interface MotionPlan {
  bindings: WireBinding[];
  frames: WireFrame[];
  prototype?: WirePrototype;
}
export interface MotionResult {
  wired: number;
  misses: string[];
  error: string | null;
}

// ---- Progress heartbeat (non-terminal) -------------------------------------
export interface ApplyProgressMessage {
  t: "apply-progress";
  reqId: string;
  phase: "variables" | "assets" | "nodes" | "layout" | "motion" | "finalize";
  done: number;
  total: number;
  note?: string;
}

/** Messages the plugin (WebSocket client) sends to the server. */
export type PluginMessage =
  | { t: "pair"; pluginVersion: string }
  | {
      t: "selection";
      doc: FigmaNode | null;
      fileName: string;
      pageName: string;
      nodeName: string | null;
    }
  | { t: "inventory"; fileName: string; pages: InventoryPage[] }
  | { t: "node"; reqId: string; doc: FigmaNode | null; nodeName: string | null }
  | { t: "assets"; reqId: string; assets: WireAsset[]; error: string | null }
  | {
      t: "screenshot";
      reqId: string;
      format: string;
      nodeName: string | null;
      error: string | null;
    }
  | { t: "search"; reqId: string; matches: SearchMatch[]; error: string | null }
  | {
      t: "components";
      reqId: string;
      components: ComponentInfo[];
      instances: InstanceInfo[];
      error: string | null;
    }
  // ---- Write direction (non-terminal progress + terminal results) ----------
  | ApplyProgressMessage
  | { t: "applied"; reqId: string; result: EmitResult | null; error: string | null }
  | { t: "foundations"; reqId: string; result: FoundationsResult | null; error: string | null }
  | { t: "motion"; reqId: string; result: MotionResult | null; error: string | null }
  | { t: "pong" };

/** Messages the server sends back to the plugin. */
export type ServerMessage =
  | { t: "plumb-hello"; serverVersion: string; sessionLabel: string }
  | { t: "paired" }
  | { t: "pair-rejected"; reason: string }
  | { t: "get-node"; reqId: string; nodeId: string }
  | {
      t: "get-assets";
      reqId: string;
      nodeId: string;
      ids?: string[];
      list?: boolean;
      /** When true, IMAGE-fill nodes are exported as the original uploaded
       *  bytes (via getImageByHash) instead of a rasterised PNG render. */
      raw?: boolean;
    }
  | {
      t: "get-screenshot";
      reqId: string;
      nodeId: string;
      scale?: number;
      format?: "PNG" | "JPG";
    }
  | { t: "get-search"; reqId: string; query?: string; type?: string }
  | { t: "get-components"; reqId: string }
  // ---- Write direction (three sequenced mutations) -------------------------
  | { t: "apply-design"; reqId: string; plan: EmitPlan }
  | { t: "apply-foundations"; reqId: string; plan: FoundationsPlan; dryRun?: boolean }
  | { t: "apply-motion"; reqId: string; plan: MotionPlan; idMap?: Record<string, string> }
  | { t: "ping" };
