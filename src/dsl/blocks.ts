/**
 * Recursive Block → PdsNode lowering.
 *
 * Blocks are the DSL's Layer-2 primitives; they map ~1:1 to PdsNode. Sections
 * (Layer 1) are pre-expanded into Blocks by sections.ts before they reach here,
 * so this module is the single place raw geometry, fills, and auto-layout land
 * in the PDS node map. Every node is minted an `el` via the shared HandleMinter
 * (seeded from the block's semantic id/name so `mode:"sync"` re-applies stay
 * stable — see blueprint §10), styled through the TokenCtx, and boxed by the
 * layout estimator.
 */

import { round } from "../util/num";
import { buildLayout, measureContainer, measureText, resolveHeight, resolveWidth, sizingFor } from "./layout";
import { mapSelf } from "./layout";
import { compileInteractions } from "./motion";
import type { HandleMinter } from "../normalize/handles";
import type { Effect, Flow, PdsNode, PdsTextRun } from "../pds";
import type { TokenCtx } from "./tokens";
import { buildComponentMaster, hasSlotBlock } from "./components";
import type {
  AssetSpec,
  Block,
  BlockBase,
  Brand,
  Button,
  Color,
  Component,
  Field,
  Instance,
  ResolvedAsset,
  Stack,
  Text,
  TextMeasurer,
  TextValue,
} from "./schema";

/** Shared state threaded through the whole lowering pass. */
export interface LowerCtx {
  tokens: TokenCtx;
  brand: Brand;
  minter: HandleMinter;
  nodes: Record<string, PdsNode>;
  /** Pre-resolved assets, keyed by `assetCacheKey(spec)`. */
  assets: Map<string, ResolvedAsset>;
  /** Optional font-metrics helper for text box sizing. */
  measurer?: TextMeasurer;
  /** Expand an Instance to its component template (from components.ts). Used
   *  only for the slot content-projection fallback (see `lowerFlattenedInstance`). */
  expandInstance: (inst: Instance) => { block: Block; componentName: string } | null;
  /** Record `component name → root el` for the sidecar. */
  onComponentInstance: (name: string, el: string) => void;
  /** Component definitions by name — the real component/instance authoring path. */
  components: Map<string, Component>;
  /** Get-or-build cache: component name → its master `type:"component"` el.
   *  Built once, lazily, on first instantiation; every later Instance of the
   *  same component reuses it (real reusable Figma component semantics). */
  componentMasters: Map<string, string>;
  /** Every master component el built this compile — collected so the compiler
   *  can attach them all under one off-canvas "Components" library frame. */
  componentLibraryEls: string[];
  warnings: string[];
}

/** Result of lowering one block: its handle and estimated box. */
export interface Lowered {
  el: string;
  box: { w: number; h: number };
}

/** Stable cache key for asset dedup — `(query, kind, seed)`. */
export function assetCacheKey(spec: AssetSpec): string {
  return `${spec.query}|${spec.kind ?? ""}|${spec.seed ?? ""}`;
}

/** Coerce a `string | AssetSpec` src into a full AssetSpec with defaults. */
export function normalizeAssetSpec(
  src: AssetSpec | string,
  defaults: Partial<AssetSpec> = {},
): AssetSpec {
  if (typeof src === "string") return { query: src, ...defaults };
  return { ...defaults, ...src };
}

/** Lower one block, writing its node into `ctx.nodes`. Returns el + box. */
export function lowerBlock(block: Block, ctx: LowerCtx, avail: number): Lowered {
  switch (block.type) {
    case "stack":
      return lowerStack(block, ctx, avail);
    case "text":
      return lowerText(block, ctx, avail);
    case "image":
      return lowerImage(block, ctx, avail);
    case "icon":
      return lowerIcon(block, ctx, avail);
    case "button":
      return lowerButton(block, ctx, avail);
    case "field":
      return lowerBlock(fieldToStack(block), ctx, avail);
    case "instance":
      return lowerInstance(block, ctx, avail);
    case "slot":
      return lowerLeaf(block, ctx, "frame", { w: 0, h: 0 });
    case "spacer": {
      const s = ctx.tokens.space(block.size, 16);
      return lowerLeaf(block, ctx, "rect", { w: s, h: s });
    }
    case "divider": {
      const w = resolveWidth(block.w, avail) ?? avail;
      const node = mkNode(block, ctx, "line");
      node.box = { w: round(w, 2), h: block.border?.width ?? 1 };
      node.stroke = ctx.tokens.colorRef(block.border?.color ?? "@border");
      node.strokeW = block.border?.width ?? 1;
      applyChildLayout(node, block);
      return { el: node.el, box: node.box };
    }
    default: {
      // Exhaustiveness guard — a new block type must be handled above.
      const _never: never = block;
      throw new Error(`lowerBlock: unhandled block ${JSON.stringify(_never)}`);
    }
  }
}

/* ------------------------------------------------------------------------ */
/* Node construction helpers                                                  */
/* ------------------------------------------------------------------------ */

function mkNode(block: BlockBase, ctx: LowerCtx, type: string): PdsNode {
  const seed = block.id ?? block.name ?? type;
  const el = ctx.minter.mint(seed, type);
  const node: PdsNode = { id: `dsl:${el}`, el, type, box: { w: 0, h: 0 } };
  if (block.name) node.name = block.name;
  applyContainerStyle(node, block, ctx);
  ctx.nodes[el] = node;
  return node;
}

/** bg / border / radius / shadow / opacity / clip — the surface styling. */
function applyContainerStyle(node: PdsNode, block: BlockBase, ctx: LowerCtx): void {
  if (block.bg !== undefined) {
    const plan = ctx.tokens.fillFor(block.bg);
    if (plan.fill) node.fill = plan.fill;
    if (plan.fills) node.fills = plan.fills;
    if (plan.assetId) node.assetId = plan.assetId;
  }
  if (block.border) {
    const c = ctx.tokens.resolveColor(block.border.color);
    node.stroke = ctx.tokens.colorRef(typeof c === "string" ? c : "@text");
    node.strokeW = block.border.width;
    if (block.border.align) node.strokeAlign = block.border.align;
    if (block.border.dash) node.strokeDash = block.border.dash;
  }
  const radius = ctx.tokens.radiusRef(block.radius);
  if (radius) node.radius = radius;

  // Shadow + background blur ("glass" material) both ride the structured
  // `effects` stack when blur is present (PdsNode can't carry the compact
  // `shadow` string alongside a structured stack) — otherwise shadow keeps
  // using the compact, dedup-friendly `$sN` ref.
  if (block.blur !== undefined && block.blur > 0) {
    const blurEffect: Effect = { type: "background-blur", radius: block.blur };
    const shadowEffects = ctx.tokens.shadowEffects(block.shadow);
    const stack = shadowEffects ? [...shadowEffects, blurEffect] : [blurEffect];
    node.effects = ctx.tokens.interner.internEffects(stack) ?? stack;
  } else {
    const shadow = ctx.tokens.shadowRef(block.shadow);
    if (shadow) node.shadow = shadow;
  }

  if (block.blend) node.blend = block.blend;
  if (block.opacity !== undefined && block.opacity < 1) node.opacity = block.opacity;
  if (block.clip) node.clip = true;
}

/** grow / self-align / sizing / absolute pos — the child-in-parent intent. */
function applyChildLayout(node: PdsNode, block: BlockBase): void {
  if (block.grow) node.grow = block.grow;
  const self = mapSelf(block.self);
  if (self) node.selfAlign = self;
  const sizing = sizingFor(block.w, block.h);
  if (sizing) node.sizing = sizing;
  if (block.pos) node.pos = { x: round(block.pos.x, 2), y: round(block.pos.y, 2) };
  // Semantic interactions → read-symmetric MotionSpec[] (motion.ts). The motion
  // build task lowers these further into the apply-motion wire plan.
  if (block.interactions?.length) {
    const motion = compileInteractions(block.interactions);
    if (motion.length) node.motion = motion;
  }
}

/** A styled leaf with an explicit box (spacer / slot / simple rects). */
function lowerLeaf(block: BlockBase, ctx: LowerCtx, type: string, box: { w: number; h: number }): Lowered {
  const node = mkNode(block, ctx, type);
  node.box = { w: round(box.w, 2), h: round(box.h, 2) };
  applyChildLayout(node, block);
  return { el: node.el, box: node.box };
}

/* ------------------------------------------------------------------------ */
/* Stack                                                                     */
/* ------------------------------------------------------------------------ */

/** A row child is flexible if it fills or grows — it shares leftover width. */
function isFlexibleChild(c: Block): boolean {
  const w = (c as { w?: unknown }).w;
  const grow = (c as { grow?: number }).grow;
  return w === "fill" || (typeof grow === "number" && grow > 0);
}

/**
 * Lower the children of a ROW, dividing the available width: fixed/hug children
 * take their measured natural width; the remainder is split among fill/grow
 * children (by grow weight). Two-pass so flexible children get a realistic
 * per-child avail instead of the whole row.
 */
function lowerRowChildren(
  children: Block[],
  ctx: LowerCtx,
  avail: number,
  gap: number,
): Lowered[] {
  const n = children.length;
  const results: (Lowered | undefined)[] = new Array(n).fill(undefined);
  const flexIdx: number[] = [];
  let fixedSum = 0;
  children.forEach((c, i) => {
    if (isFlexibleChild(c)) {
      flexIdx.push(i);
      return;
    }
    const r = lowerBlock(c, ctx, avail);
    results[i] = r;
    fixedSum += r.box.w;
  });
  if (flexIdx.length) {
    const totalGap = gap * Math.max(0, n - 1);
    const remainder = Math.max(0, avail - totalGap - fixedSum);
    const weights = flexIdx.map((i) => Math.max(1, (children[i] as { grow?: number }).grow ?? 1));
    const weightSum = weights.reduce((a, b) => a + b, 0) || 1;
    flexIdx.forEach((i, k) => {
      const share = remainder * (weights[k]! / weightSum);
      results[i] = lowerBlock(children[i]!, ctx, Math.max(0, share));
    });
  }
  return results.map((r, i) => r ?? lowerBlock(children[i]!, ctx, avail));
}

function lowerStack(block: Stack, ctx: LowerCtx, avail: number): Lowered {
  const node = mkNode(block, ctx, "frame");
  const flow: Flow = block.dir === "row" ? "row" : "col";
  const pad = ctx.tokens.pad(block.pad);
  const gap = ctx.tokens.space(block.gap);
  const gapCross = ctx.tokens.space(block.gapCross);

  const ownW = resolveWidth(block.w, avail);
  const inner = (ownW ?? avail) - pad[3] - pad[1];
  const childAvail = Math.max(inner, 0);

  // In a ROW, fill/grow siblings must SHARE the available width — not each take
  // the full row (which inflated multi-column estimates ~N×). Columns stack, so
  // each child still gets the full inner width.
  const kids: Lowered[] =
    flow === "row" && block.children.length > 1
      ? lowerRowChildren(block.children, ctx, childAvail, gap)
      : block.children.map((c) => lowerBlock(c, ctx, childAvail));

  const layout = buildLayout(flow, {
    gap,
    gapCross,
    pad,
    justify: block.justify,
    align: block.align,
    wrap: block.wrap,
  });
  const layoutRef = ctx.tokens.layoutRef(layout);
  if (layoutRef) node.layout = layoutRef;
  else node.layout = layout;

  const measured = measureContainer(
    flow,
    gap,
    pad,
    kids.map((k) => k.box),
  );
  const w = ownW ?? measured.w;
  const h = resolveHeight(block.h) ?? measured.h;
  node.box = { w: round(w, 2), h: round(h, 2) };
  node.children = kids.map((k) => k.el);
  applyChildLayout(node, block);
  return { el: node.el, box: node.box };
}

/* ------------------------------------------------------------------------ */
/* Text                                                                      */
/* ------------------------------------------------------------------------ */

function lowerText(block: Text, ctx: LowerCtx, avail: number): Lowered {
  const node = mkNode(block, ctx, "text");
  const type = ctx.tokens.typeFor(block.style, "@text");
  if (type.ref) node.text = type.ref;

  const fixedW = resolveWidth(block.w, avail);
  const chars = flattenText(block.text);
  const wrapW = fixedW ?? avail;
  const box = measureText(chars, type.rts, wrapW, ctx.measurer);

  // Colour: explicit Text.color wins, else the type style's colour, else brand
  // text. Carried as a full FillPlan (not `colorRef`) so a gradient survives
  // as a `$fN` fill stack instead of being flattened to its first stop.
  const fillPlan = block.color !== undefined ? ctx.tokens.fillFor(block.color) : type.fillPlan;
  if (fillPlan?.fill) node.fill = fillPlan.fill;
  if (fillPlan?.fills) node.fills = fillPlan.fills;

  if (Array.isArray(block.text)) node.chars = buildRuns(block.text, ctx, type.ref);
  else node.chars = chars;

  if (type.decoration) node.textDecoration = type.decoration;
  // Horizontal text alignment — validated by the schema but was never applied,
  // so centered/right headlines rendered left. DSL "justify" → PDS "justified".
  if (block.textAlign) {
    node.textAlign = block.textAlign === "justify" ? "justified" : block.textAlign;
  }
  // Auto-resize by width intent (server-side has no font metrics, so a fixed box
  // sized to the estimate wraps/clips): hug width → hug both axes so labels never
  // wrap; fill/fixed width → fix width and grow height so paragraphs wrap.
  if (block.resize) node.textGrow = block.resize;
  else node.textGrow = fixedW === undefined ? "wh" : "h";

  node.box = { w: round(fixedW ?? box.w, 2), h: round(box.h, 2) };
  applyChildLayout(node, block);
  return { el: node.el, box: node.box };
}

function flattenText(tv: TextValue): string {
  return typeof tv === "string" ? tv : tv.map((r) => r.t).join("");
}

function buildRuns(runs: import("./schema").TextRun[], ctx: LowerCtx, dominant: string | undefined): PdsTextRun[] {
  return runs.map((r) => {
    const out: PdsTextRun = { t: r.t };
    if (r.style) {
      const ref = ctx.tokens.typeFor(r.style).ref;
      if (ref && ref !== dominant) out.s = ref;
    }
    if (r.color !== undefined) out.c = ctx.tokens.colorRef(r.color);
    if (r.decoration) out.d = r.decoration;
    return out;
  });
}

/* ------------------------------------------------------------------------ */
/* Image                                                                     */
/* ------------------------------------------------------------------------ */

function lowerImage(block: import("./schema").Image, ctx: LowerCtx, avail: number): Lowered {
  const spec = normalizeAssetSpec(block.src, { kind: "photo", role: "card-image" });
  const resolved = ctx.assets.get(assetCacheKey(spec));
  const node = mkNode(block, ctx, "rect");

  const w = resolveWidth(block.w, avail) ?? resolved?.w ?? spec.w ?? avail;
  let h = resolveHeight(block.h) ?? spec.h ?? resolved?.h;
  if (h === undefined) {
    const aspect = spec.aspect ?? (resolved?.w && resolved?.h ? resolved.w / resolved.h : 1.6);
    h = w / (aspect || 1.6);
  }

  if (resolved?.assetId) {
    const plan = ctx.tokens.imageFillFor(resolved.assetId, block.fit ?? resolved.scaleMode);
    node.fill = plan.fill;
    if (plan.fills) node.fills = plan.fills;
    node.assetId = plan.assetId;
  } else {
    // Graceful degradation: a muted placeholder rather than a failed page.
    node.fill = ctx.tokens.solidRef("#e5e7eb");
    ctx.warnings.push(`image "${spec.query}" unresolved — placeholder emitted`);
  }

  node.box = { w: round(w, 2), h: round(h, 2) };
  applyChildLayout(node, block);
  return { el: node.el, box: node.box };
}

/* ------------------------------------------------------------------------ */
/* Icon                                                                      */
/* ------------------------------------------------------------------------ */

function lowerIcon(block: import("./schema").Icon, ctx: LowerCtx, _avail: number): Lowered {
  const spec: AssetSpec = { query: block.name, kind: "icon", role: "icon" };
  const resolved = ctx.assets.get(assetCacheKey(spec));
  const size = block.size ?? 24;
  const colorTok: Color = block.color ?? "@text";

  let node: PdsNode;
  if (resolved?.vectorPath) {
    node = mkNode(block, ctx, "vector");
    node.vectorPath = resolved.vectorPath;
    node.fill = ctx.tokens.colorRef(colorTok);
  } else if (resolved?.assetId) {
    node = mkNode(block, ctx, "rect");
    const plan = ctx.tokens.imageFillFor(resolved.assetId, "fit");
    node.fill = plan.fill;
    if (plan.fills) node.fills = plan.fills;
    node.assetId = plan.assetId;
  } else {
    node = mkNode(block, ctx, "vector");
    node.fill = ctx.tokens.colorRef(colorTok);
    ctx.warnings.push(`icon "${block.name}" unresolved — placeholder emitted`);
  }
  node.iconHint = block.name;
  node.box = { w: size, h: size };
  applyChildLayout(node, block);
  return { el: node.el, box: node.box };
}

/* ------------------------------------------------------------------------ */
/* Button (→ pattern:"button" frame)                                         */
/* ------------------------------------------------------------------------ */

const BTN_PAD: Record<NonNullable<Button["size"]>, [number, number]> = {
  sm: [8, 14],
  md: [10, 18],
  lg: [14, 24],
};
const BTN_ICON: Record<NonNullable<Button["size"]>, number> = { sm: 16, md: 18, lg: 20 };

function lowerButton(block: Button, ctx: LowerCtx, avail: number): Lowered {
  const stack = buttonToStack(block, ctx.brand);
  const lowered = lowerBlock(stack, ctx, avail);
  const node = ctx.nodes[lowered.el];
  if (node) node.pattern = "button";
  return lowered;
}

/** Expand a Button into its concrete row Stack (icon? + label), variant-styled. */
export function buttonToStack(b: Button, brand: Brand): Stack {
  const variant = b.variant ?? "primary";
  const size = b.size ?? "md";
  const [pv, ph] = BTN_PAD[size];

  let bg: Color | undefined;
  let border: BlockBase["border"];
  let textColor: Color = "@onPrimary";
  let decoration: "underline" | undefined;

  switch (variant) {
    case "primary":
      bg = "@primary";
      textColor = "@onPrimary";
      break;
    case "secondary":
      bg = brand.colors.surface ? "@surface" : "@muted";
      textColor = "@text";
      break;
    case "outline":
      border = { color: "@primary", width: 1 };
      textColor = "@primary";
      break;
    case "ghost":
      textColor = "@primary";
      break;
    case "link":
      textColor = "@primary";
      decoration = "underline";
      break;
  }

  const children: Block[] = [];
  const icon: Block | undefined = b.icon
    ? { type: "icon", name: b.icon, size: BTN_ICON[size], color: textColor }
    : undefined;
  const labelSize = size === "lg" ? 17 : size === "sm" ? 14 : 15;
  const label: Text = {
    type: "text",
    text: b.label,
    style: { size: labelSize, weight: 600, font: "body", ...(decoration ? { decoration } : {}) },
    color: textColor,
  };
  if (icon && b.iconPos !== "right") children.push(icon);
  children.push(label);
  if (icon && b.iconPos === "right") children.push(icon);

  const link = variant === "link";
  const radius = b.radius ?? (brand.radius?.md !== undefined ? "md" : 8);

  return {
    type: "stack",
    id: b.id,
    name: b.name ?? b.label,
    dir: "row",
    gap: 8,
    align: "center",
    justify: "center",
    pad: link ? 0 : [pv, ph],
    ...(bg ? { bg } : {}),
    ...(border ? { border } : {}),
    ...(link ? {} : { radius }),
    ...(b.shadow ? { shadow: b.shadow } : {}),
    ...(b.w ? { w: b.w } : {}),
    ...(b.grow ? { grow: b.grow } : {}),
    ...(b.self ? { self: b.self } : {}),
    ...(b.pos ? { pos: b.pos } : {}),
    ...(b.interactions ? { interactions: b.interactions } : {}),
    children,
  };
}

/* ------------------------------------------------------------------------ */
/* Field (→ labelled input Stack)                                            */
/* ------------------------------------------------------------------------ */

function fieldToStack(f: Field): Stack {
  const kind = f.kind ?? "text";
  const inputChildren: Block[] = [];
  if (f.placeholder) {
    inputChildren.push({
      type: "text",
      text: f.placeholder,
      style: { size: 15, weight: 400, font: "body" },
      color: "@muted",
    });
  }
  const input: Stack = {
    type: "stack",
    name: `${kind} input`,
    dir: "row",
    align: "center",
    pad: kind === "textarea" ? [12, 14, 40, 14] : [10, 14],
    w: "fill",
    bg: "@bg",
    border: { color: "@border", width: 1 },
    radius: 8,
    children: inputChildren,
  };

  const children: Block[] = [];
  if (f.label) {
    children.push({
      type: "text",
      text: f.label,
      style: { size: 14, weight: 500, font: "body" },
      color: "@text",
    });
  }
  children.push(input);

  return {
    type: "stack",
    id: f.id,
    name: f.name ?? f.label ?? "field",
    dir: "col",
    gap: 6,
    w: f.w ?? "fill",
    children,
  };
}

/* ------------------------------------------------------------------------ */
/* Instance (component expansion)                                            */
/* ------------------------------------------------------------------------ */

function lowerInstance(block: Instance, ctx: LowerCtx, avail: number): Lowered {
  const comp = ctx.components.get(block.component);
  if (!comp) {
    ctx.warnings.push(`instance of unknown component "${block.component}" — placeholder emitted`);
    return lowerLeaf(block, ctx, "frame", { w: avail, h: 0 });
  }
  // A component with slot content-projection can't be a real Figma INSTANCE —
  // an instance's children are locked to its main component's structure, and
  // slots need per-call content splicing. Fall back to deep-clone expansion.
  const hasSlotContent = block.slots && Object.keys(block.slots).length > 0;
  if (hasSlotBlock(comp.body) || hasSlotContent) {
    return lowerFlattenedInstance(block, ctx, avail);
  }
  return lowerRealInstance(block, ctx, avail, comp);
}

/** Legacy path (slotted components): deep-clone the component body inline,
 *  tagged with `component` metadata so the round-trip still records the
 *  relationship — but NOT a real Figma component/instance pair. */
function lowerFlattenedInstance(block: Instance, ctx: LowerCtx, avail: number): Lowered {
  const expanded = ctx.expandInstance(block);
  if (!expanded) {
    ctx.warnings.push(`instance of unknown component "${block.component}" — placeholder emitted`);
    return lowerLeaf(block, ctx, "frame", { w: avail, h: 0 });
  }
  const lowered = lowerBlock(expanded.block, ctx, avail);
  const node = ctx.nodes[lowered.el];
  if (node) {
    node.component = { id: `dsl:${expanded.componentName}` };
    if (block.props) {
      const ref = ctx.tokens.interner.internProps(block.props);
      if (ref) node.props = ref;
    }
    ctx.onComponentInstance(expanded.componentName, lowered.el);
  }
  return lowered;
}

/** Real reusable component: build the master ONCE (cached by name, tagged
 *  `type:"component"`), then every reference creates a genuine `type:"instance"`
 *  node bound to it via `component.id` (the master's `el` — the plugin
 *  resolves same-plan els first, falling back to a live Figma node id or a
 *  published library component key for cross-file references). */
function lowerRealInstance(block: Instance, ctx: LowerCtx, avail: number, comp: Component): Lowered {
  let masterEl = ctx.componentMasters.get(comp.name);
  if (!masterEl) {
    const body = buildComponentMaster(comp);
    const lowered = lowerBlock(body, ctx, avail);
    const masterNode = ctx.nodes[lowered.el];
    if (masterNode) masterNode.type = "component";
    masterEl = lowered.el;
    ctx.componentMasters.set(comp.name, masterEl);
    ctx.componentLibraryEls.push(masterEl);
    ctx.onComponentInstance(comp.name, masterEl);
  }
  const masterNode = ctx.nodes[masterEl];
  const node = mkNode(block, ctx, "instance");
  node.component = { id: masterEl };
  if (block.props) {
    const ref = ctx.tokens.interner.internProps(block.props);
    if (ref) node.props = ref;
  }
  const w = resolveWidth(block.w, avail) ?? masterNode?.box.w ?? avail;
  const h = resolveHeight(block.h) ?? masterNode?.box.h ?? 0;
  node.box = { w: round(w, 2), h: round(h, 2) };
  applyChildLayout(node, block);
  return { el: node.el, box: node.box };
}
