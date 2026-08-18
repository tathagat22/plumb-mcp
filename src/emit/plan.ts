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

import { resolveLayout, toChildLayout, toEmitLayout } from "./plan/layout";
import { resolveColor, resolveFills, solidPaint } from "./plan/paint";
import { resolveEffects, resolveRadius, resolveVector } from "./plan/effects";
import { FontSet, lowerText } from "./plan/text";
import { buildAssets } from "./plan/assets";
import type { LowerOptions } from "./plan/types";

export type { LowerAssetInfo, LowerOptions } from "./plan/types";
import type {
  EmitNode,
  EmitNodeType,
  EmitOp,
  EmitPlan,
  } from "../bridge/protocol";
import type {
  PdsDocument,
  PdsNode,
  TokenTable,
} from "../pds";

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
