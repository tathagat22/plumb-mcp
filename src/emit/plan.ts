/**
 * `lowerToEmitPlan(pds, opts)` — the server-side inverse of the normalizer.
 *
 * Takes a `PdsDocument` (as produced by `src/dsl/compile.ts`, byte-shape
 * identical to `normalize()` output) and lowers it to a fully-resolved,
 * Figma-native `EmitPlan` that the plugin (`figma-plugin/emit.ts`) executes
 * MECHANICALLY. Every CSS→Figma conversion happens HERE (blueprint §1, §11):
 *   - token refs (`$cN/$tN/$rN/$sN/$lN/$fN/$eN/$vN`) resolved against the table,
 *   - hex → rgb 0..1 channels + separate opacity,
 *   - CSS `flex-start/center/…` → `MIN/CENTER/MAX/SPACE_BETWEEN`,
 *   - `{weight, size, family}` type strings → `{family, style}` + fontSize,
 *   - linear-gradient angle → a Figma `gradientTransform` matrix,
 *   - CSS `box-shadow` strings → `EmitEffect` drop/inner shadows.
 *
 * The plugin never parses any of this; it just assigns what the plan carries.
 */

import { hexToRgba01 } from "../dsl/tokens";
import type {
  EmitAsset,
  EmitChildLayout,
  EmitEffect,
  EmitLayout,
  EmitNode,
  EmitNodeType,
  EmitOp,
  EmitPaint,
  EmitPlan,
  EmitTarget,
  EmitText,
  EmitTextRun,
  FontFace,
} from "../bridge/protocol";
import type {
  Effect,
  Fill,
  GradientFill,
  ImageFill,
  PdsDocument,
  PdsLayout,
  PdsNode,
  PdsTextRun,
  SolidFill,
  TokenTable,
} from "../pds";

/** Extra per-asset info the caller (asset engine) supplies so image/svg fills
 *  can ship bytes. Keyed by `PdsNode.assetId` (== the inbound stage key). */
export interface LowerAssetInfo {
  ext: EmitAsset["ext"];
  kind: EmitAsset["kind"];
  svgInline?: string;
  w?: number;
  h?: number;
}

export interface LowerOptions {
  planId: string;
  target: EmitTarget;
  mode: "create" | "sync";
  prune?: boolean;
  reveal?: boolean;
  /** Compiler component sidecar — carried for parity; not required. */
  components?: Record<string, { id: string; el: string; props: unknown[] }>;
  /** PdsNode.assetId → staged asset info (ext/kind/bytes-location). */
  assets?: Record<string, LowerAssetInfo>;
}

/* ------------------------------------------------------------------------ */
/* Entry point                                                               */
/* ------------------------------------------------------------------------ */

export function lowerToEmitPlan(pds: PdsDocument, opts: LowerOptions): EmitPlan {
  const tokens = pds.tokens;
  const ops: EmitOp[] = [];
  const fonts = new FontSet();
  const assetRefs = new Set<string>();

  const visit = (el: string, parent: string | null, seen: Set<string>): void => {
    if (seen.has(el)) return;
    seen.add(el);
    const node = pds.nodes[el];
    if (!node) return; // compressed / disclosure-boundary child — nothing to build
    const emit = lowerNode(node, tokens, fonts, assetRefs);
    ops.push({ key: el, parent, node: emit });
    for (const child of node.children ?? []) visit(child, el, seen);
  };
  visit(pds.root, null, new Set());

  const assets = buildAssets(assetRefs, opts.assets);

  return {
    planId: opts.planId,
    target: opts.target,
    mode: opts.mode,
    prune: opts.prune,
    reveal: opts.reveal,
    fonts: fonts.list(),
    ...(assets.length ? { assets } : {}),
    ops,
  };
}

/* ------------------------------------------------------------------------ */
/* Node lowering                                                              */
/* ------------------------------------------------------------------------ */

const EMIT_TYPES: ReadonlySet<string> = new Set<EmitNodeType>([
  "frame",
  "text",
  "rect",
  "ellipse",
  "line",
  "vector",
  "instance",
  "component",
  "group",
]);

function emitTypeOf(type: string): EmitNodeType {
  return (EMIT_TYPES.has(type) ? type : "frame") as EmitNodeType;
}

function lowerNode(
  node: PdsNode,
  tokens: TokenTable,
  fonts: FontSet,
  assetRefs: Set<string>,
): EmitNode {
  const type = emitTypeOf(node.type);
  const en: EmitNode = {
    type,
    size: { w: node.box.w, h: node.box.h },
  };
  if (node.name) en.name = node.name;

  // --- Layout (container) --------------------------------------------------
  const layout = resolveLayout(node.layout, tokens);
  if (layout) en.layout = toEmitLayout(layout);

  // --- Child-in-parent intent ---------------------------------------------
  const child = toChildLayout(node);
  if (child) en.child = child;

  // --- Position / absolute -------------------------------------------------
  if (node.pos) en.pos = { x: node.pos.x, y: node.pos.y };

  // --- Fills ---------------------------------------------------------------
  const fills = resolveFills(node, tokens, assetRefs);
  if (fills && fills.length) en.fills = fills;

  // --- Stroke --------------------------------------------------------------
  if (node.stroke) {
    const paint = solidPaint(resolveColor(node.stroke, tokens));
    if (paint) en.strokes = [paint];
  }
  if (node.strokeW !== undefined) en.strokeWeight = node.strokeW;
  if (node.strokeAlign) en.strokeAlign = node.strokeAlign.toUpperCase() as EmitNode["strokeAlign"];
  if (node.strokeSides) en.strokeSides = node.strokeSides;
  if (node.strokeDash && node.strokeDash.length) en.dashPattern = node.strokeDash;

  // --- Corner radius -------------------------------------------------------
  const radius = resolveRadius(node.radius, tokens);
  if (radius !== undefined) en.cornerRadius = radius;

  // --- Effects (shadow / blur) --------------------------------------------
  const effects = resolveEffects(node, tokens);
  if (effects && effects.length) en.effects = effects;

  // --- Misc visual ---------------------------------------------------------
  if (node.opacity !== undefined) en.opacity = node.opacity;
  if (node.clip) en.clip = true;
  if (node.rotation !== undefined) en.rotation = node.rotation;
  if (node.blend) en.blendMode = node.blend.toUpperCase().replace(/-/g, "_");
  if (node.constraints) en.constraints = node.constraints;

  // --- Vector paths --------------------------------------------------------
  if (type === "vector" && node.vectorPath) {
    const d = resolveVector(node.vectorPath, tokens);
    if (d) en.vectorPaths = [{ data: d }];
  }

  // --- Text ----------------------------------------------------------------
  if (type === "text") {
    const text = lowerText(node, tokens, fonts);
    if (text) en.text = text;
    // Figma renders text colour as a fill on the TEXT node.
    if (!en.fills && node.fill) {
      const paint = solidPaint(resolveColor(node.fill, tokens));
      if (paint) en.fills = [paint];
    }
  }

  // --- Instance → main component --------------------------------------------
  if (type === "instance" && node.component) {
    en.instanceOf = typeof node.component === "string" ? node.component : node.component.id;
    const props = resolveProps(node.props, tokens);
    if (props) en.componentProps = props;
  }

  return en;
}

/** Resolve `PdsNode.props` (a `$pN` ref or the literal override map) against
 *  the token table's compound `props` namespace. */
function resolveProps(
  props: PdsNode["props"],
  tokens: TokenTable,
): Record<string, string | boolean | number> | undefined {
  if (props === undefined) return undefined;
  if (typeof props === "string") return tokens.props?.[props];
  return props;
}

/* ------------------------------------------------------------------------ */
/* Layout                                                                     */
/* ------------------------------------------------------------------------ */

function resolveLayout(
  layout: PdsLayout | string | undefined,
  tokens: TokenTable,
): PdsLayout | undefined {
  if (layout === undefined) return undefined;
  if (typeof layout === "string") return tokens.layout?.[layout];
  return layout;
}

const JUSTIFY_TO_PRIMARY: Record<string, NonNullable<EmitLayout["primary"]>> = {
  "flex-start": "MIN",
  center: "CENTER",
  "flex-end": "MAX",
  "space-between": "SPACE_BETWEEN",
};

const ALIGN_TO_COUNTER: Record<string, NonNullable<EmitLayout["counter"]>> = {
  "flex-start": "MIN",
  center: "CENTER",
  "flex-end": "MAX",
  baseline: "BASELINE",
};

function toEmitLayout(l: PdsLayout): EmitLayout {
  const [t, r, b, left] = l.pad;
  const out: EmitLayout = {
    mode: l.flow === "row" ? "HORIZONTAL" : "VERTICAL",
    pad: { t, r, b, l: left },
  };
  if (l.gap !== undefined) out.gap = l.gap;
  if (l.gapCross !== undefined) out.gapCross = l.gapCross;
  if (l.justify && JUSTIFY_TO_PRIMARY[l.justify]) out.primary = JUSTIFY_TO_PRIMARY[l.justify];
  if (l.align && ALIGN_TO_COUNTER[l.align]) out.counter = ALIGN_TO_COUNTER[l.align];
  if (l.wrap) out.wrap = true;
  return out;
}

const SELF_TO_ALIGN: Record<string, NonNullable<EmitChildLayout["align"]>> = {
  stretch: "STRETCH",
  min: "MIN",
  center: "CENTER",
  max: "MAX",
};

function toChildLayout(node: PdsNode): EmitChildLayout | undefined {
  const out: EmitChildLayout = {};
  let set = false;
  if (node.grow) {
    out.grow = node.grow;
    set = true;
  }
  if (node.selfAlign && SELF_TO_ALIGN[node.selfAlign]) {
    out.align = SELF_TO_ALIGN[node.selfAlign];
    set = true;
  }
  if (node.sizing?.w) {
    out.sizingH = node.sizing.w === "fill" ? "FILL" : node.sizing.w === "fixed" ? "FIXED" : "HUG";
    set = true;
  }
  if (node.sizing?.h) {
    out.sizingV = node.sizing.h === "fill" ? "FILL" : node.sizing.h === "fixed" ? "FIXED" : "HUG";
    set = true;
  }
  return set ? out : undefined;
}

/* ------------------------------------------------------------------------ */
/* Colour / fills                                                             */
/* ------------------------------------------------------------------------ */

/** Resolve a `$cN` ref (or a literal hex) to a hex string. */
function resolveColor(ref: string, tokens: TokenTable): string | undefined {
  if (ref.startsWith("$")) return tokens.color[ref];
  if (ref.startsWith("#")) return ref;
  return undefined;
}

/** Hex → a SOLID EmitPaint, folding alpha into `opacity`. */
function solidPaint(hex: string | undefined): EmitPaint | undefined {
  if (!hex) return undefined;
  const c = hexToRgba01(hex);
  const paint: EmitPaint = { type: "SOLID", color: { r: c.r, g: c.g, b: c.b } };
  const a = c.a ?? 1;
  if (a < 1) paint.opacity = a;
  return paint;
}

const SCALE_MODE: Record<string, NonNullable<Extract<EmitPaint, { type: "IMAGE" }>["scaleMode"]>> = {
  fill: "FILL",
  fit: "FIT",
  crop: "CROP",
  tile: "TILE",
  stretch: "FILL",
};

/** Resolve `node.fills` (ref `$fN` or literal) plus the compact `node.fill`. */
function resolveFills(
  node: PdsNode,
  tokens: TokenTable,
  assetRefs: Set<string>,
): EmitPaint[] | undefined {
  const stack = resolveFillStack(node.fills, tokens);
  if (stack) {
    const out: EmitPaint[] = [];
    for (const f of stack) {
      const p = fillToPaint(f, assetRefs);
      if (p) out.push(p);
    }
    return out.length ? out : undefined;
  }
  // No structured stack — fall back to the compact `fill` ref (solids only;
  // "gradient"/"image" markers require the stack, handled above).
  if (node.fill && node.fill.startsWith("$c")) {
    const p = solidPaint(resolveColor(node.fill, tokens));
    return p ? [p] : undefined;
  }
  return undefined;
}

function resolveFillStack(
  fills: Fill[] | string | undefined,
  tokens: TokenTable,
): Fill[] | undefined {
  if (fills === undefined) return undefined;
  if (typeof fills === "string") return tokens.fills?.[fills];
  return fills;
}

function fillToPaint(f: Fill, assetRefs: Set<string>): EmitPaint | undefined {
  if (f.type === "color") return solidFillToPaint(f);
  if (f.type === "image") return imageFillToPaint(f, assetRefs);
  return gradientFillToPaint(f);
}

function solidFillToPaint(f: SolidFill): EmitPaint | undefined {
  const c = hexToRgba01(f.color);
  const paint: EmitPaint = { type: "SOLID", color: { r: c.r, g: c.g, b: c.b } };
  const alpha = (c.a ?? 1) * (f.opacity ?? 1);
  if (alpha < 1) paint.opacity = alpha;
  if (f.var) paint.boundVar = f.var;
  return paint;
}

function imageFillToPaint(f: ImageFill, assetRefs: Set<string>): EmitPaint | undefined {
  if (!f.assetId) return undefined;
  assetRefs.add(f.assetId);
  const paint: Extract<EmitPaint, { type: "IMAGE" }> = { type: "IMAGE", assetRef: f.assetId };
  if (f.scaleMode && SCALE_MODE[f.scaleMode]) paint.scaleMode = SCALE_MODE[f.scaleMode];
  if (f.opacity !== undefined && f.opacity < 1) paint.opacity = f.opacity;
  return paint;
}

type GradientPaintType = "GRADIENT_LINEAR" | "GRADIENT_RADIAL" | "GRADIENT_ANGULAR" | "GRADIENT_DIAMOND";

const GRADIENT_TYPE: Record<GradientFill["type"], GradientPaintType> = {
  "linear-gradient": "GRADIENT_LINEAR",
  "radial-gradient": "GRADIENT_RADIAL",
  "angular-gradient": "GRADIENT_ANGULAR",
  "diamond-gradient": "GRADIENT_DIAMOND",
};

function gradientFillToPaint(f: GradientFill): EmitPaint | undefined {
  const type = GRADIENT_TYPE[f.type];
  const stops = f.stops.map((s) => {
    const c = hexToRgba01(s.color);
    return { position: s.at, color: { r: c.r, g: c.g, b: c.b, a: c.a ?? 1 } };
  });
  const paint: Extract<EmitPaint, { type: typeof type }> = { type, stops };
  if (f.type === "linear-gradient" && f.angle !== undefined) {
    paint.transform = linearGradientTransform(f.angle);
  }
  if (f.opacity !== undefined && f.opacity < 1) paint.opacity = f.opacity;
  return paint;
}

/**
 * CSS linear-gradient angle (0 = up, clockwise) → Figma `gradientTransform`
 * (the node→gradient-space affine). Inverse of `normalize/paint.ts`
 * `gradientAngle()`, so a write→read round-trip recovers the same angle.
 */
function linearGradientTransform(angleDeg: number): [[number, number, number], [number, number, number]] {
  const phi = ((angleDeg - 90) * Math.PI) / 180;
  const dx = Math.cos(phi);
  const dy = Math.sin(phi);
  // Handles in 0..1 space: gradient axis centred, unit length.
  const h0x = 0.5 - dx * 0.5;
  const h0y = 0.5 - dy * 0.5;
  // T = inverse of [[dx,-dy,h0x],[dy,dx,h0y]] (rotation, det=1).
  return [
    [dx, dy, -(dx * h0x + dy * h0y)],
    [-dy, dx, dy * h0x - dx * h0y],
  ];
}

/* ------------------------------------------------------------------------ */
/* Radius / effects / vector                                                 */
/* ------------------------------------------------------------------------ */

function resolveRadius(
  radius: string | [number, number, number, number] | undefined,
  tokens: TokenTable,
): number | [number, number, number, number] | undefined {
  if (radius === undefined) return undefined;
  if (Array.isArray(radius)) return radius;
  if (radius.startsWith("$")) {
    const v = tokens.radius[radius];
    if (v === undefined) return undefined;
    return v === "full" ? 9999 : v;
  }
  const n = Number(radius);
  return Number.isFinite(n) ? n : undefined;
}

function resolveEffects(node: PdsNode, tokens: TokenTable): EmitEffect[] | undefined {
  // Prefer the structured stack (ref `$eN` or literal Effect[]).
  let stack: Effect[] | undefined;
  if (Array.isArray(node.effects)) stack = node.effects;
  else if (typeof node.effects === "string") stack = tokens.effects?.[node.effects];

  if (stack && stack.length) {
    const out: EmitEffect[] = [];
    for (const e of stack) {
      const em = effectToEmit(e);
      if (em) out.push(em);
    }
    return out.length ? out : undefined;
  }

  // Fall back to the compact `shadow` field: `$sN` ref → CSS, or raw CSS.
  if (node.shadow) {
    const css = node.shadow.startsWith("$") ? tokens.shadow[node.shadow] : node.shadow;
    if (css) return parseBoxShadow(css);
  }
  return undefined;
}

function effectToEmit(e: Effect): EmitEffect | undefined {
  if (e.type === "drop-shadow" || e.type === "inner-shadow") {
    const c = hexToRgba01(e.color);
    return {
      type: e.type === "drop-shadow" ? "DROP_SHADOW" : "INNER_SHADOW",
      color: { r: c.r, g: c.g, b: c.b, a: c.a ?? 1 },
      offset: { x: e.x, y: e.y },
      radius: e.blur,
      spread: e.spread,
    };
  }
  if (e.type === "layer-blur" || e.type === "background-blur") {
    return {
      type: e.type === "layer-blur" ? "LAYER_BLUR" : "BACKGROUND_BLUR",
      radius: e.radius,
    };
  }
  return undefined;
}

/** Parse a CSS box-shadow list (the `effectsToCss` format) into EmitEffects. */
function parseBoxShadow(css: string): EmitEffect[] {
  const out: EmitEffect[] = [];
  for (const raw of splitShadows(css)) {
    const part = raw.trim();
    if (!part) continue;
    const inset = part.startsWith("inset");
    const body = inset ? part.slice(5).trim() : part;
    // "{ox}px {oy}px {blur}px {spread}px {hex}"
    const m = /^(-?[\d.]+)px\s+(-?[\d.]+)px\s+(-?[\d.]+)px\s+(-?[\d.]+)px\s+(#[0-9a-fA-F]+)$/.exec(body);
    if (!m) continue;
    const c = hexToRgba01(m[5]!);
    out.push({
      type: inset ? "INNER_SHADOW" : "DROP_SHADOW",
      color: { r: c.r, g: c.g, b: c.b, a: c.a ?? 1 },
      offset: { x: Number(m[1]), y: Number(m[2]) },
      radius: Number(m[3]),
      spread: Number(m[4]),
    });
  }
  return out;
}

/** Split a shadow list on commas that are NOT inside a color/paren group. */
function splitShadows(css: string): string[] {
  return css.split(/,(?![^(]*\))/);
}

function resolveVector(vector: string, tokens: TokenTable): string | undefined {
  if (vector.startsWith("$")) return tokens.vector?.[vector];
  return vector;
}

/* ------------------------------------------------------------------------ */
/* Text                                                                       */
/* ------------------------------------------------------------------------ */

interface TypeMetrics {
  family: string;
  weight: number;
  size: number;
  lineHeightPx?: number;
  tracking?: number;
}

/** Parse a `$tN` text token ("{weight} {size}px[/{lh}][ {family}][ {track}px]"). */
function resolveType(ref: string | undefined, tokens: TokenTable): TypeMetrics | undefined {
  if (!ref) return undefined;
  const raw = ref.startsWith("$") ? tokens.text[ref] : ref;
  if (!raw) return undefined;
  const m = /^(\d+)\s+([\d.]+)px(?:\/([\d.]+))?(.*)$/.exec(raw.trim());
  if (!m) return undefined;
  const weight = Number(m[1]);
  const size = Number(m[2]);
  const lhRatio = m[3] !== undefined ? Number(m[3]) : undefined;
  let rest = (m[4] ?? "").trim();
  let tracking: number | undefined;
  const tm = /\s?(-?[\d.]+)px$/.exec(rest);
  if (tm) {
    tracking = Number(tm[1]);
    rest = rest.slice(0, tm.index).trim();
  }
  const family = rest || "Inter";
  const out: TypeMetrics = { family, weight, size };
  if (lhRatio !== undefined) out.lineHeightPx = round2(lhRatio * size);
  if (tracking !== undefined) out.tracking = tracking;
  return out;
}

function lowerText(node: PdsNode, tokens: TokenTable, fonts: FontSet): EmitText | undefined {
  const metrics = resolveType(node.text, tokens) ?? {
    family: "Inter",
    weight: 400,
    size: 16,
  };
  const font = faceFor(metrics.family, metrics.weight);
  fonts.add(font);

  const characters = charsToString(node.chars);
  const out: EmitText = {
    characters,
    font,
    fontSize: metrics.size,
  };
  if (metrics.lineHeightPx !== undefined) out.lineHeightPx = metrics.lineHeightPx;
  if (metrics.tracking !== undefined) out.letterSpacing = metrics.tracking;
  if (node.textAlign) out.align = node.textAlign.toUpperCase() as EmitText["align"];
  if (node.textDecoration) {
    out.decoration = node.textDecoration === "underline" ? "UNDERLINE" : "STRIKETHROUGH";
  }
  out.autoResize = textAutoResize(node.textGrow);

  const runs = buildRuns(node.chars, tokens, fonts, metrics);
  if (runs.length) out.runs = runs;
  return out;
}

function charsToString(chars: PdsNode["chars"]): string {
  if (chars === undefined) return "";
  if (typeof chars === "string") return chars;
  return chars.map((r) => r.t).join("");
}

function textAutoResize(grow: PdsNode["textGrow"]): NonNullable<EmitText["autoResize"]> {
  switch (grow) {
    case "h":
      return "HEIGHT";
    case "wh":
      return "WIDTH_AND_HEIGHT";
    case "trunc":
      return "TRUNCATE";
    default:
      return "NONE";
  }
}

function buildRuns(
  chars: PdsNode["chars"],
  tokens: TokenTable,
  fonts: FontSet,
  base: TypeMetrics,
): EmitTextRun[] {
  if (!Array.isArray(chars)) return [];
  const runs: EmitTextRun[] = [];
  let cursor = 0;
  for (const r of chars) {
    const start = cursor;
    const end = cursor + r.t.length;
    cursor = end;
    if (end <= start) continue;
    const run = runOverrides(r, start, end, tokens, fonts, base);
    if (run) runs.push(run);
  }
  return runs;
}

function runOverrides(
  r: PdsTextRun,
  start: number,
  end: number,
  tokens: TokenTable,
  fonts: FontSet,
  base: TypeMetrics,
): EmitTextRun | undefined {
  const run: EmitTextRun = { start, end };
  let set = false;
  if (r.s) {
    const m = resolveType(r.s, tokens);
    if (m) {
      const face = faceFor(m.family, m.weight);
      fonts.add(face);
      run.font = face;
      run.fontSize = m.size;
      if (m.lineHeightPx !== undefined) run.lineHeightPx = m.lineHeightPx;
      if (m.tracking !== undefined) run.letterSpacing = m.tracking;
      set = true;
    }
  }
  if (r.c) {
    const paint = solidPaint(resolveColor(r.c, tokens));
    if (paint) {
      run.fills = [paint];
      set = true;
    }
  }
  if (r.d) {
    run.decoration = r.d === "underline" ? "UNDERLINE" : "STRIKETHROUGH";
    set = true;
  }
  void base;
  return set ? run : undefined;
}

/* ------------------------------------------------------------------------ */
/* Fonts                                                                      */
/* ------------------------------------------------------------------------ */

const WEIGHT_STYLE: Record<number, string> = {
  100: "Thin",
  200: "Extra Light",
  300: "Light",
  400: "Regular",
  500: "Medium",
  600: "Semi Bold",
  700: "Bold",
  800: "Extra Bold",
  900: "Black",
};

function faceFor(family: string, weight: number): FontFace {
  const bucket = Math.max(100, Math.min(900, Math.round(weight / 100) * 100));
  return { family, style: WEIGHT_STYLE[bucket] ?? "Regular" };
}

/** Deduped, order-preserving set of the fonts a plan uses. */
class FontSet {
  private readonly seen = new Set<string>();
  private readonly faces: FontFace[] = [];
  add(f: FontFace): void {
    const k = `${f.family} ${f.style}`;
    if (this.seen.has(k)) return;
    this.seen.add(k);
    this.faces.push(f);
  }
  list(): FontFace[] {
    return this.faces.slice();
  }
}

/* ------------------------------------------------------------------------ */
/* Assets                                                                     */
/* ------------------------------------------------------------------------ */

function buildAssets(
  refs: Set<string>,
  info: LowerOptions["assets"],
): EmitAsset[] {
  if (!info) return [];
  const out: EmitAsset[] = [];
  for (const ref of refs) {
    const a = info[ref];
    if (!a) continue;
    const asset: EmitAsset = { ref, ext: a.ext, kind: a.kind };
    if (a.svgInline) asset.svgInline = a.svgInline;
    if (a.w !== undefined) asset.w = a.w;
    if (a.h !== undefined) asset.h = a.h;
    out.push(asset);
  }
  return out;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
