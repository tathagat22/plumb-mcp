import { HandleMinter } from "./handles";
import { toLayout } from "./layout";
import { backdropFilterCss, effectsToStack, paintsToFillStack } from "./paint";
import { TokenInterner } from "./tokens";
import { detectSuspiciousText } from "./typo";
import { estimateTokens } from "../util/estimate";
import { cleanPx, round } from "../util/num";
import type {
  FigmaFileResult,
  FigmaNode,
  FigmaReaction,
  FigmaTransition,
} from "../figma/types";
import type { Fill, MotionSpec, PdsDocument, PdsLayout, PdsNode } from "../pds";

const TYPE_MAP: Record<string, string> = {
  FRAME: "frame",
  GROUP: "group",
  TEXT: "text",
  RECTANGLE: "rect",
  ELLIPSE: "ellipse",
  LINE: "line",
  VECTOR: "vector",
  STAR: "star",
  POLYGON: "polygon",
  INSTANCE: "instance",
  COMPONENT: "component",
  COMPONENT_SET: "component-set",
  BOOLEAN_OPERATION: "bool",
  SECTION: "section",
};

export interface NormalizeOptions {
  /** Include human-readable notes per node (opt-in, plan §7). */
  notes?: boolean;
  /** Soft token budget; the response flags itself if it exceeds this. */
  maxTokens?: number;
  /**
   * Pre-built el/minter state. When provided, normalize skips its own preWalk
   * and reuses this state — used by `normalizeToBudget` so multi-iteration
   * budget loops don't re-walk the input tree N times.
   */
  precomputed?: PrecomputedHandles;
}

export interface PrecomputedHandles {
  elById: Map<string, string>;
  minter: HandleMinter;
}

/**
 * Build the depth-independent el-handle map for a Figma tree.
 *
 * Walks the entire visible tree exactly once and assigns each node a stable
 * `el` handle. Pulled out of `normalize` so a budget loop can reuse this work
 * across depth-step iterations — the el assignment doesn't change with depth,
 * so re-walking it for every retry is pure waste.
 *
 * The minter is returned alongside so walks that encounter a node missing
 * from `elById` (e.g. an invisible root that's now being emitted at level 0)
 * can mint a fresh handle without colliding with existing ones.
 */
export function buildPreWalk(file: FigmaFileResult): PrecomputedHandles {
  const minter = new HandleMinter();
  const elById = new Map<string, string>();
  // Walk visible nodes only — invisible subtrees never appear in PDS, so
  // there's no value in claiming handles for them and risking collisions
  // with descendants of visible ones.
  function preWalk(fn: FigmaNode, level: number): void {
    if (level > 0 && fn.visible === false) return;
    elById.set(fn.id, minter.mint(fn.name ?? "", fn.type ?? ""));
    const kids = (fn.children ?? []).filter((k) => k.visible !== false);
    for (const child of kids) preWalk(child, level + 1);
  }
  preWalk(file.document, 0);
  return { elById, minter };
}

/**
 * The heart of Plumb: a raw Figma subtree → the Plumb Design Spec.
 * Dedups styles into a token table, prunes invisible nodes and default noise,
 * resolves auto-layout to flexbox, and emits a flat `el`-keyed node map.
 */
export function normalize(
  file: FigmaFileResult,
  depth: number,
  opts: NormalizeOptions = {},
): PdsDocument {
  const interner = new TokenInterner();
  const nodes: Record<string, PdsNode> = {};

  // Reuse pre-built el/minter state when provided (budget-loop fast path),
  // otherwise walk the tree to build them. The pre-pass is depth-independent
  // — the el assignment doesn't change between iterations — so reusing it
  // turns a multi-step budget loop from N walks into 1.
  const { elById, minter } = opts.precomputed ?? buildPreWalk(file);

  // Surfaces of interest for inheritedFill — nodes a renderer would tag with
  // `background:` if they had their own fill. Text/vector/icon-like leaves
  // don't need the inherited info: text inherits color via CSS naturally,
  // and vectors render their own paths.
  const SURFACE_TYPES = new Set(["frame", "group", "rect", "instance", "component"]);

  function walk(
    fn: FigmaNode,
    level: number,
    parent?: FigmaNode,
    parentPath?: string,
    inheritedFill?: string,
    grandparent?: FigmaNode,
    ancestors: FigmaNode[] = [],
  ): string | undefined {
    // Prune invisible nodes — but never the requested root (level 0).
    if (level > 0 && fn.visible === false) return undefined;

    const el = elById.get(fn.id) ?? minter.mint(fn.name ?? "", fn.type ?? "");
    const path = parentPath ? `${parentPath}.${el}` : el;
    const node: PdsNode = {
      id: fn.id,
      el,
      type: TYPE_MAP[fn.type] ?? fn.type.toLowerCase(),
      box: {
        w: round(fn.absoluteBoundingBox?.width ?? 0),
        h: round(fn.absoluteBoundingBox?.height ?? 0),
      },
    };
    // Only emit `name` when it carries actual signal — Figma auto-generates
    // "Frame 12", "Rectangle 3", "Vector", etc. and those repeat across
    // hundreds of nodes for no agent benefit. The `el` handle already
    // encodes identity.
    if (fn.name && isDescriptive(fn.name)) node.name = fn.name;
    // Only emit `path` once we're past the root — root's path is just its own
    // `el`, which is already on the node.
    if (parentPath) node.path = path;

    const pos = relativePos(parent, fn);
    if (pos) node.pos = pos;

    // Per-child auto-layout sizing — only meaningful when the parent has
    // auto-layout. `grow`/`selfAlign`/`sizing` answer "how does this child
    // fill its parent" — without them, agents default to flex's "shrink to
    // content" and stretchy columns collapse, the #1 layout failure.
    const parentIsAutoLayout = !!(parent?.layoutMode && parent.layoutMode !== "NONE");
    if (parentIsAutoLayout) {
      if (typeof fn.layoutGrow === "number" && fn.layoutGrow > 0) {
        node.grow = fn.layoutGrow;
      }
      const selfAlign = normalizeLayoutAlign(fn.layoutAlign);
      if (selfAlign) node.selfAlign = selfAlign;
      const sizing = childSizing(fn);
      if (sizing) node.sizing = sizing;
    }

    const layout = toLayout(fn);
    if (layout) {
      // Compute contentMain BEFORE interning — the slack value is part of
      // the layout identity, so finalising it after the ref is minted would
      // either miss the dedup or mutate a shared table entry.
      if (layout.justify) {
        const visibleKids = (fn.children ?? []).filter((k) => k.visible !== false);
        if (visibleKids.length >= 2) {
          const isCol = layout.flow === "col";
          const sumMain = visibleKids.reduce((acc, k) => {
            const dim = isCol
              ? round(k.absoluteBoundingBox?.height ?? 0)
              : round(k.absoluteBoundingBox?.width ?? 0);
            return acc + dim;
          }, 0);
          const gapTotal = (visibleKids.length - 1) * (layout.gap ?? 0);
          const contentMain = sumMain + gapTotal;
          const containerMain = isCol ? node.box.h : node.box.w;
          const padStart = isCol ? layout.pad[0] : layout.pad[3];
          const padEnd = isCol ? layout.pad[2] : layout.pad[1];
          const available = containerMain - padStart - padEnd;
          if (available - contentMain >= 4) layout.contentMain = contentMain;
        }
      }
      // Intern the finished layout — dense list screens with 20 identical
      // row layouts ship 1 table entry + 20 short refs instead of 20 copies
      // of the same 80-char object.
      node.layout = interner.internLayout(layout);
    }

    // Full fill stack — the smoking-gun fix for "20% white" being a
    // multi-fill glass treatment, or "gradient" being a stop-less placeholder.
    const fills = paintsToFillStack(fn.fills);
    const fill = interner.internColor(fn.fills);
    if (fills) {
      const firstImage = fills.find((f): f is Fill & { type: "image" } => f.type === "image");
      if (firstImage && firstImage.assetId) node.assetId = firstImage.assetId;
      // Don't intern fill stacks that contain image fills — assetId is
      // per-node, and the existing fingerprint scrub in `compressRepeats`
      // relies on the literal stack being readable to ignore per-row
      // photos. Solid/gradient stacks are safe to intern.
      const hasImage = fills.some((f) => f.type === "image");
      node.fills = hasImage ? fills : (interner.internFills(fills) ?? fills);
    } else if (fill) {
      // Compact dominant fill — only emitted when the full stack didn't
      // ship (single-solid case), so the two fields are strictly disjoint.
      node.fill = fill;
    }

    // Surface the nearest ancestor's solid fill when this node has none of
    // its own — the renderer can read it directly instead of walking the
    // tree. Only meaningful for nodes that render a surface (frame/group/etc).
    if (!fill && inheritedFill && SURFACE_TYPES.has(node.type)) {
      node.inheritedFill = inheritedFill;
    }
    // What we hand down to children — this node's own fill if it has one,
    // otherwise whatever it inherited.
    const fillForChildren = fill ?? inheritedFill;

    const iconHint = inferIconHint(fn, parent, grandparent, ancestors, node);
    if (iconHint) node.iconHint = iconHint;

    const pattern = inferPattern(fn, node, layout);
    if (pattern) node.pattern = pattern;

    const stroke = interner.internColor(fn.strokes);
    if (stroke) {
      node.stroke = stroke;
      if (fn.strokeWeight) {
        const w = cleanPx(fn.strokeWeight);
        if (w) node.strokeW = w;
      }
      const align = normalizeStrokeAlign(fn.strokeAlign);
      if (align) node.strokeAlign = align;
      const sides = perSideStrokeWidths(fn, node.strokeW);
      if (sides) node.strokeSides = sides;
      if (Array.isArray(fn.dashPattern) && fn.dashPattern.length > 0) {
        node.strokeDash = fn.dashPattern.map((n) => round(n, 2));
      }
    }

    const radius = cornerRadius(fn, node.box);
    if (typeof radius === "number" || radius === "full") {
      const ref = interner.internRadius(radius);
      if (ref) node.radius = ref;
    } else if (radius) {
      node.radius = radius; // per-corner tuple, inlined
    }
    if (typeof fn.cornerRadiusVar === "string" && fn.cornerRadiusVar.length > 0) {
      node.radiusVar = fn.cornerRadiusVar;
    }

    const effects = effectsToStack(fn.effects);
    const shadow = interner.internShadow(fn.effects);
    if (effects) {
      node.effects = interner.internEffects(effects);
    } else if (shadow) {
      // Compact dominant shadow — only when the full effects stack didn't
      // ship, so the two fields are strictly disjoint.
      node.shadow = shadow;
    }
    const backdrop = backdropFilterCss(fn.effects);
    if (backdrop) node.backdropFilter = backdrop;

    if (fn.opacity != null && fn.opacity < 1) node.opacity = round(fn.opacity, 2);
    if (fn.clipsContent) node.clip = true;

    if (fn.isMask === true) {
      node.isMask = true;
      const mode = normalizeMaskType(fn.maskType);
      if (mode) node.maskMode = mode;
    }

    // Inline vector path for small icons — saves an entire `plumb_assets`
    // round-trip per icon. Only single-path, single-winding-rule cases
    // under the per-node char budget. Bigger / multi-rule paths fall
    // through to plumb_assets.
    const inlined = inlineVectorPath(fn);
    if (inlined) node.vectorPath = interner.internVector(inlined);

    if (fn.type === "TEXT") {
      const text = interner.internText(fn.style);
      if (text) node.text = text;
      const dec = fn.style?.textDecoration;
      if (dec === "UNDERLINE") node.textDecoration = "underline";
      else if (dec === "STRIKETHROUGH") node.textDecoration = "line-through";

      // v0.10 Phase 3 — mixed inline styles. When the plugin captured runs
      // (a bold word inside a sentence, a coloured link, etc.) emit them
      // as a PdsTextRun[] under `chars`. The dominant style still sits on
      // node.text / node.fill so simple renderers can ignore runs and ship
      // the concatenated string correctly.
      const runs = fn.characterRuns;
      const dominantFill = node.fill;
      if (Array.isArray(runs) && runs.length > 1) {
        const builtRuns: import("../pds").PdsTextRun[] = runs.map((r) => {
          const sRef = interner.internText(r.style);
          const cRef = interner.internColor(r.fills);
          const runDec = r.style?.textDecoration;
          const dRun =
            runDec === "UNDERLINE"
              ? ("underline" as const)
              : runDec === "STRIKETHROUGH"
                ? ("line-through" as const)
                : undefined;
          const out: import("../pds").PdsTextRun = { t: r.characters };
          // Only emit overrides — agents reconstruct by inheriting from
          // the node's dominant style/fill/decoration when these are absent.
          if (sRef && sRef !== text) out.s = sRef;
          if (cRef && cRef !== dominantFill) out.c = cRef;
          if (dRun && dRun !== node.textDecoration) out.d = dRun;
          return out;
        });
        node.chars = builtRuns;
      } else if (typeof fn.characters === "string") {
        node.chars = fn.characters;
      }
    }

    if (fn.type === "INSTANCE" && typeof fn.componentId === "string") {
      // v0.10 Phase 3 — surface variant identity alongside the component
      // id so agents can route to the right codebase variant without
      // re-parsing `props`. Flatten variantProperties into Figma's own
      // "Key=Val,Key=Val" form, which matches how Figma displays variants
      // in the UI and what most design-system docs call them.
      const vp = fn.variantProperties;
      if (vp && typeof vp === "object" && Object.keys(vp).length > 0) {
        const variant = Object.entries(vp)
          .map(([k, v]) => `${k}=${v}`)
          .join(",");
        node.component = { id: fn.componentId, variant };
      } else {
        node.component = fn.componentId;
      }
    }

    const props = normalizeComponentProps(fn.componentProperties);
    if (props) node.props = interner.internProps(props);

    // v0.10 Phase 3 — fidelity passthroughs. Each only emitted when the
    // plugin captured it (non-default), so unchanged nodes stay terse.
    if (typeof fn.rotation === "number") node.rotation = round(fn.rotation);
    if (typeof fn.blendMode === "string") node.blend = cssBlendMode(fn.blendMode);
    if (typeof fn.cornerSmoothing === "number") node.smooth = fn.cornerSmoothing;
    if (typeof fn.textAutoResize === "string") {
      node.textGrow = pdsTextGrow(fn.textAutoResize);
    }
    // Constraints only matter when the parent has no auto-layout — flex
    // children ignore CSS pinning. Drop them on auto-layout children to
    // save tokens and avoid misleading agents.
    if (fn.constraints && !(parent?.layoutMode && parent.layoutMode !== "NONE")) {
      const h = pdsConstraint(fn.constraints.horizontal, "h");
      const v = pdsConstraint(fn.constraints.vertical, "v");
      if (h || v) node.constraints = { ...(h && { h }), ...(v && { v }) };
    }
    const minSize: { w?: number; h?: number } = {};
    const maxSize: { w?: number; h?: number } = {};
    if (typeof fn.minWidth === "number") minSize.w = fn.minWidth;
    if (typeof fn.minHeight === "number") minSize.h = fn.minHeight;
    if (typeof fn.maxWidth === "number") maxSize.w = fn.maxWidth;
    if (typeof fn.maxHeight === "number") maxSize.h = fn.maxHeight;
    if (minSize.w !== undefined || minSize.h !== undefined) node.sizingMin = minSize;
    if (maxSize.w !== undefined || maxSize.h !== undefined) node.sizingMax = maxSize;

    const motion = motionFromReactions(fn.reactions);
    if (motion) node.motion = motion;

    if (opts.notes) {
      const notes = buildNotes(fn);
      if (notes.length) node.notes = notes;
    }

    // Progressive disclosure (plan §5/§7): expand children only while above the
    // disclosure depth. At the boundary, record how many children exist via
    // `more` so the agent knows to drill in with another plumb_node call.
    // Plugin-side truncation (v0.10 Phase 2) hands us `childCount` instead
    // of an inflated children array; honour it when present.
    const kids = (fn.children ?? []).filter((k) => k.visible !== false);
    const truncatedHere = kids.length === 0 && typeof fn.childCount === "number" && fn.childCount > 0;
    if (level >= depth || truncatedHere) {
      const remaining = truncatedHere ? fn.childCount : kids.length;
      if (remaining) node.more = remaining;
    } else {
      const childEls: string[] = [];
      // A mask child shapes every later sibling inside the same container
      // (Figma's `isMask` semantics). Track the most recent mask el and tag
      // subsequent siblings with `masked` so the renderer can apply the
      // mask's fills as CSS `mask-image` instead of drawing it standalone.
      let currentMaskEl: string | undefined;
      // Trim to 4 deep — enough for iconHint to climb past a few generic
      // containers without retaining an unbounded ancestor chain in memory.
      const childAncestors = [fn, ...ancestors].slice(0, 4);
      for (const child of kids) {
        const childEl = walk(child, level + 1, fn, path, fillForChildren, parent, childAncestors);
        if (!childEl) continue;
        childEls.push(childEl);
        if (child.isMask === true) {
          currentMaskEl = childEl;
        } else if (currentMaskEl) {
          const childNode = nodes[childEl];
          if (childNode) childNode.masked = currentMaskEl;
        }
      }
      if (childEls.length) node.children = childEls;
    }

    nodes[el] = node;
    // Repeating-list compression — only runs when children are present
    // and we're below the disclosure boundary (i.e. children were actually
    // walked). Mutates `nodes` to delete compressed sibling subtrees and
    // sets `node.repeat` on the parent.
    if (node.children && node.children.length >= REPEAT_MIN) {
      compressRepeats(node, nodes);
    }
    return el;
  }

  const root = walk(file.document, 0);
  if (!root) {
    // Unreachable: the root is force-included regardless of visibility.
    throw new Error("normalize: root node produced no output");
  }

  const tokens = interner.table();
  const estTokens = estimateTokens(JSON.stringify({ tokens, nodes }));

  const doc: PdsDocument = {
    file: { name: file.fileName, version: file.version },
    root,
    tokens,
    nodes,
    meta: {
      nodeCount: Object.keys(nodes).length,
      estTokens,
      depthUsed: depth,
    },
    next:
      "Read `tokens` for the design system, then build the UI from `nodes`. " +
      "Tag each rendered element data-plumb-id=\"<el>\". " +
      "A node with a `more` count has that many children not yet included — " +
      "call plumb_node again on that node's `id` to expand them.",
  };

  const suspicious = detectSuspiciousText(nodes);
  if (suspicious.length) doc.meta.suspiciousText = suspicious;

  if (opts.maxTokens && estTokens > opts.maxTokens) {
    doc.meta.truncated = true;
    doc.meta.hint =
      `Response is ~${estTokens} tokens, over the ${opts.maxTokens} budget. ` +
      "Re-call plumb_node with a smaller `depth`, or on a specific child `el`.";
  }

  return doc;
}

/* ---------------------------------------------------------------------- */
/* Repeating-list compression                                               */
/* ---------------------------------------------------------------------- */

/** Minimum consecutive identical-fingerprint siblings to compress. */
const REPEAT_MIN = 3;

/**
 * Structural fingerprint for a PDS subtree. Two nodes have the same
 * fingerprint iff their shape, styling, and layout are identical — modulo
 * the fields that legitimately vary between list items (`chars`, `assetId`,
 * `id`, `el`, `name`, `path`, `pos`).
 */
function fingerprintSubtree(el: string, nodes: Record<string, PdsNode>): string {
  const n = nodes[el];
  if (!n) return "";
  // Walk children first, then build a canonical JSON representation. Sorted
  // keys keep the output stable across Node versions / object insertion order.
  const childPrints = (n.children ?? []).map((c) => fingerprintSubtree(c, nodes));
  // Strip varying fields. Image fills: scrub the per-instance assetId so two
  // rows with different photos still match. A ref string is already a stable
  // identity (image-fill stacks aren't interned, so refs only appear for
  // solid/gradient stacks where the assetId scrub is a no-op).
  const fillsForPrint =
    typeof n.fills === "string"
      ? n.fills
      : (n.fills ?? []).map((f) =>
          f.type === "image" ? { ...f, assetId: undefined } : f,
        );
  const skeleton: Record<string, unknown> = {
    type: n.type,
    box: n.box,
    layout: n.layout,
    fill: n.fill,
    fills: fillsForPrint.length > 0 ? fillsForPrint : undefined,
    inheritedFill: n.inheritedFill,
    stroke: n.stroke,
    strokeW: n.strokeW,
    strokeAlign: n.strokeAlign,
    strokeSides: n.strokeSides,
    strokeDash: n.strokeDash,
    radius: n.radius,
    radiusVar: n.radiusVar,
    shadow: n.shadow,
    effects: n.effects,
    backdropFilter: n.backdropFilter,
    opacity: n.opacity,
    clip: n.clip,
    text: n.text,
    textDecoration: n.textDecoration,
    component: n.component,
    pattern: n.pattern,
    // iconHint + notes are DERIVED from per-instance data (sibling chars,
    // etc.) so they legitimately vary across otherwise-identical rows.
    // Excluded here; iconHint surfaces as an override below.
    isMask: n.isMask,
    maskMode: n.maskMode,
    masked: n.masked,
    grow: n.grow,
    selfAlign: n.selfAlign,
    sizing: n.sizing,
    vectorPath: n.vectorPath,
    childPrints,
  };
  return JSON.stringify(canonicalize(skeleton));
}

/** Recursively drop undefined fields and sort keys for a stable JSON form. */
function canonicalize(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(canonicalize);
  if (v && typeof v === "object") {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(v as Record<string, unknown>).sort()) {
      const val = (v as Record<string, unknown>)[k];
      if (val === undefined) continue;
      out[k] = canonicalize(val);
    }
    return out;
  }
  return v;
}

/**
 * Walk two same-shape subtrees in lockstep and collect the per-leaf
 * differences (`chars`, `assetId`) keyed by the TEMPLATE's el — so the
 * agent renders the template once and applies these overrides per row.
 */
function extractOverrides(
  templateEl: string,
  instanceEl: string,
  nodes: Record<string, PdsNode>,
): Record<
  string,
  { chars?: string | import("../pds").PdsTextRun[]; assetId?: string; iconHint?: string }
> {
  const out: Record<
    string,
    { chars?: string | import("../pds").PdsTextRun[]; assetId?: string; iconHint?: string }
  > = {};
  function walkPair(tEl: string, iEl: string): void {
    const t = nodes[tEl];
    const i = nodes[iEl];
    if (!t || !i) return;
    const delta: {
      chars?: string | import("../pds").PdsTextRun[];
      assetId?: string;
      iconHint?: string;
    } = {};
    if (t.chars !== i.chars && i.chars !== undefined) delta.chars = i.chars;
    if (t.assetId !== i.assetId && i.assetId !== undefined) delta.assetId = i.assetId;
    if (t.iconHint !== i.iconHint && i.iconHint !== undefined) delta.iconHint = i.iconHint;
    if (
      delta.chars !== undefined ||
      delta.assetId !== undefined ||
      delta.iconHint !== undefined
    ) {
      out[tEl] = delta;
    }
    const tKids = t.children ?? [];
    const iKids = i.children ?? [];
    const n = Math.min(tKids.length, iKids.length);
    for (let k = 0; k < n; k++) walkPair(tKids[k]!, iKids[k]!);
  }
  walkPair(templateEl, instanceEl);
  return out;
}

/** Recursively delete a node and its descendants from the nodes map. */
function deleteSubtree(el: string, nodes: Record<string, PdsNode>): void {
  const n = nodes[el];
  if (!n) return;
  for (const c of n.children ?? []) deleteSubtree(c, nodes);
  delete nodes[el];
}

/**
 * After the parent's children have been walked, detect consecutive runs of
 * identical-fingerprint siblings (≥ REPEAT_MIN) and collapse each run into
 * a single template + per-instance override map on the parent's `repeat`
 * field. Mutates `nodes` in place (removes compressed siblings).
 */
function compressRepeats(parent: PdsNode, nodes: Record<string, PdsNode>): void {
  const kids = parent.children;
  if (!kids || kids.length < REPEAT_MIN) return;
  const prints = kids.map((k) => fingerprintSubtree(k, nodes));
  // Find the first run of REPEAT_MIN+ identical fingerprints. V1: collapse
  // ONE run per parent — the most common shape (homogeneous list inside a
  // single container). Heterogeneous lists with multiple runs can come later.
  let runStart = -1;
  let runLen = 0;
  for (let i = 0; i < prints.length; i++) {
    if (i > 0 && prints[i] === prints[i - 1] && prints[i]!.length > 0) {
      if (runStart === -1) {
        runStart = i - 1;
        runLen = 2;
      } else {
        runLen++;
      }
    } else if (runStart !== -1 && runLen >= REPEAT_MIN) {
      break;
    } else {
      runStart = -1;
      runLen = 0;
    }
  }
  if (runStart === -1 || runLen < REPEAT_MIN) return;

  const templateEl = kids[runStart]!;
  const data: Record<
    string,
    Record<
      string,
      { chars?: string | import("../pds").PdsTextRun[]; assetId?: string; iconHint?: string }
    >
  > = {};
  for (let i = runStart + 1; i < runStart + runLen; i++) {
    const instanceEl = kids[i]!;
    const overrides = extractOverrides(templateEl, instanceEl, nodes);
    data[instanceEl] = overrides;
    deleteSubtree(instanceEl, nodes);
  }
  parent.repeat = { template: templateEl, data };
}

/* ---------------------------------------------------------------------- */
/* Component property overrides                                             */
/* ---------------------------------------------------------------------- */

function normalizeComponentProps(
  raw: FigmaNode["componentProperties"],
): Record<string, string | boolean | number> | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const out: Record<string, string | boolean | number> = {};
  for (const [key, entry] of Object.entries(raw)) {
    if (!entry || typeof entry !== "object") continue;
    const value = (entry as { value?: unknown }).value;
    if (typeof value !== "string" && typeof value !== "boolean" && typeof value !== "number") {
      continue;
    }
    // Strip Figma's `#id:idx` internal suffix — "Label#10:0" → "Label".
    const cleanKey = key.replace(/#[^#]*$/, "");
    out[cleanKey] = value;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/* ---------------------------------------------------------------------- */
/* Inline vector path                                                       */
/* ---------------------------------------------------------------------- */

/** Per-icon budget for the COMBINED `d` (all subpaths). Bigger icons still
 * ship via `plumb_assets`. */
const VECTOR_INLINE_MAX = 600;

function inlineVectorPath(fn: FigmaNode): string | undefined {
  const geom = fn.fillGeometry;
  if (!Array.isArray(geom) || geom.length === 0) return undefined;
  // v0.10 Phase 3 — accept multi-subpath icons. Every production icon set
  // (Heroicons, Phosphor, Material) uses 2-3 subpaths for cutouts. We
  // concat the `d` strings with a space — SVG renders that as a single
  // path command sequence under one fill-rule.
  const ds: string[] = [];
  for (const entry of geom) {
    if (!entry) continue;
    const d = typeof entry.path === "string" ? entry.path : entry.data;
    if (typeof d === "string" && d.length > 0) ds.push(d);
  }
  if (ds.length === 0) return undefined;
  const combined = ds.join(" ");
  if (combined.length > VECTOR_INLINE_MAX) return undefined;
  return combined;
}

/* ---------------------------------------------------------------------- */
/* Auto-layout child sizing                                                 */
/* ---------------------------------------------------------------------- */

function normalizeLayoutAlign(
  raw: string | undefined,
): "stretch" | "min" | "center" | "max" | undefined {
  switch (raw) {
    case "STRETCH":
      return "stretch";
    case "MIN":
      return "min";
    case "CENTER":
      return "center";
    case "MAX":
      return "max";
    default:
      // "INHERIT" and undefined → don't override the parent's align-items.
      return undefined;
  }
}

function childSizing(
  fn: FigmaNode,
): { w?: "fill" | "hug"; h?: "fill" | "hug" } | undefined {
  const w = sizingValue(fn.layoutSizingHorizontal);
  const h = sizingValue(fn.layoutSizingVertical);
  if (!w && !h) return undefined;
  const out: { w?: "fill" | "hug"; h?: "fill" | "hug" } = {};
  if (w) out.w = w;
  if (h) out.h = h;
  return out;
}

function sizingValue(raw: string | undefined): "fill" | "hug" | undefined {
  // FIXED is the default and already implied by box.{w,h} — skip.
  if (raw === "FILL") return "fill";
  if (raw === "HUG") return "hug";
  return undefined;
}

/* ---------------------------------------------------------------------- */
/* Stroke alignment + per-side widths                                       */
/* ---------------------------------------------------------------------- */

function normalizeStrokeAlign(
  raw: string | undefined,
): "inside" | "outside" | "center" | undefined {
  switch (raw) {
    case "INSIDE":
      return "inside";
    case "OUTSIDE":
      return "outside";
    case "CENTER":
      return "center";
    default:
      return undefined;
  }
}

function perSideStrokeWidths(
  fn: FigmaNode,
  uniform: number | undefined,
): { t: number; r: number; b: number; l: number } | undefined {
  // REST ships `individualStrokeWeights: { top, right, bottom, left }`;
  // plugin ships them as flat `strokeTopWeight` / etc. Read either form.
  const isw = fn.individualStrokeWeights;
  const t = isw?.top ?? fn.strokeTopWeight;
  const r = isw?.right ?? fn.strokeRightWeight;
  const b = isw?.bottom ?? fn.strokeBottomWeight;
  const l = isw?.left ?? fn.strokeLeftWeight;
  if (t == null && r == null && b == null && l == null) return undefined;

  const tr = round(t ?? uniform ?? 0, 2);
  const rr = round(r ?? uniform ?? 0, 2);
  const br = round(b ?? uniform ?? 0, 2);
  const lr = round(l ?? uniform ?? 0, 2);
  // Only emit when at least one side actually differs — uniform borders
  // already covered by `strokeW`.
  if (tr === rr && rr === br && br === lr) return undefined;
  return { t: tr, r: rr, b: br, l: lr };
}

/* ---------------------------------------------------------------------- */
/* Mask mode                                                                */
/* ---------------------------------------------------------------------- */

function normalizeMaskType(
  raw: string | undefined,
): "alpha" | "luminance" | "vector" | undefined {
  switch (raw) {
    case "ALPHA":
      return "alpha";
    case "LUMINANCE":
      return "luminance";
    case "VECTOR":
    case "GEOMETRY":
      return "vector";
    default:
      // Unknown / unspecified — fall through. The presence of `isMask` alone
      // is still enough for the renderer to know it's a mask.
      return undefined;
  }
}

/* ---------------------------------------------------------------------- */
/* Motion specs — Figma prototype reactions                                 */
/* ---------------------------------------------------------------------- */

function easingFromFigma(tr: FigmaTransition | undefined): string | undefined {
  if (!tr) return undefined;
  const cubic = tr.easing?.easingFunctionCubicBezier;
  if (Array.isArray(cubic) && cubic.length === 4) {
    return `cubic-bezier(${cubic.map((n) => round(n, 3)).join(",")})`;
  }
  const kind = tr.easing?.type ?? tr.easingType;
  if (!kind) return undefined;
  switch (kind) {
    case "EASE_IN":
      return "ease-in";
    case "EASE_OUT":
      return "ease-out";
    case "EASE_IN_AND_OUT":
    case "EASE_IN_OUT":
      return "ease-in-out";
    case "LINEAR":
      return "linear";
    default:
      return kind.toLowerCase().replace(/_/g, "-");
  }
}

function motionFromReactions(reactions: FigmaReaction[] | undefined): MotionSpec[] | undefined {
  if (!reactions?.length) return undefined;
  const out: MotionSpec[] = [];
  for (const r of reactions) {
    const trigger = r.trigger?.type;
    if (!trigger) continue;
    const action = r.action;
    if (!action) continue;
    const tr = action.transition;
    const kind = tr?.type ?? action.type ?? "INSTANT";
    const spec: MotionSpec = { trigger, kind };
    // Figma stores duration in seconds on REST, sometimes in ms on plugin.
    // Both feel awkward; normalise to ms.
    if (typeof tr?.duration === "number") {
      const ms = tr.duration > 10 ? tr.duration : tr.duration * 1000;
      spec.duration = round(ms, 0);
    }
    const easing = easingFromFigma(tr);
    if (easing) spec.easing = easing;
    if (action.destinationId) spec.target = action.destinationId;
    // v0.10 Phase 3 — overlay positioning. Captured by plugin's
    // serializeReactions; REST tolerated but typically absent.
    const overlayPos = action.overlayRelativePosition;
    const overlayBg = action.overlayBackground;
    if (overlayPos || overlayBg) {
      const overlay: NonNullable<MotionSpec["overlay"]> = {};
      if (overlayPos && typeof overlayPos.x === "number" && typeof overlayPos.y === "number") {
        overlay.pos = { x: round(overlayPos.x), y: round(overlayPos.y) };
      }
      if (overlayBg && overlayBg.type !== "NONE") {
        const c = overlayBg.color;
        if (c) {
          // RGBA → CSS hex with alpha.
          const channel = (n: number): string =>
            Math.round(n * 255).toString(16).padStart(2, "0");
          let hex = `#${channel(c.r)}${channel(c.g)}${channel(c.b)}`;
          if (c.a !== undefined && c.a < 1) hex += channel(c.a);
          overlay.background = hex;
        }
      }
      if (overlay.pos || overlay.background) spec.overlay = overlay;
    }
    out.push(spec);
  }
  return out.length ? out : undefined;
}

/* ---------------------------------------------------------------------- */
/* Icon-swap hints                                                          */
/* ---------------------------------------------------------------------- */

/** Names Figma auto-generates that carry no semantic information. */
const GENERIC_NAME =
  /^(image|vector|rectangle|rect|ellipse|circle|line|frame|group|instance|node|layer|shape|path|union|subtract|intersect|exclude|component)\s*\d*$/i;

const ICON_MAX_SIZE = 64;

/** Strip the trailing "Button" / "Icon" / "IconButton" noise from a name. */
function cleanIconLabel(s: string): string {
  return s
    .replace(/([a-z])([A-Z])/g, "$1 $2") // SearchButton → "Search Button"
    .replace(/[_-]+/g, " ")
    .replace(/\b(icon|button|btn|iconbutton|cta)\b/gi, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function isDescriptive(name: string): boolean {
  if (!name) return false;
  const cleaned = cleanIconLabel(name);
  if (!cleaned) return false;
  if (GENERIC_NAME.test(cleaned)) return false;
  return cleaned.length >= 2;
}

function hasImageFill(fn: FigmaNode): boolean {
  if (!Array.isArray(fn.fills)) return false;
  return fn.fills.some((p) => p?.visible !== false && p?.type === "IMAGE");
}

function isIconShaped(node: PdsNode, fn: FigmaNode): boolean {
  if (node.box.w > ICON_MAX_SIZE || node.box.h > ICON_MAX_SIZE) return false;
  if (node.box.w === 0 || node.box.h === 0) return false;
  const aspect = node.box.w / node.box.h;
  if (aspect < 0.5 || aspect > 2) return false;
  if (hasImageFill(fn)) return true;
  if (fn.type === "VECTOR" || fn.type === "BOOLEAN_OPERATION") return true;
  const name = (node.name ?? "").toLowerCase();
  if (name.includes("icon")) return true;
  return false;
}

/** First TEXT sibling under `parent` with non-empty characters, skipping the
 *  subtree rooted at `excludeId` (the icon node we're labelling). */
function findTextSibling(
  parent: FigmaNode | undefined,
  excludeId: string,
): string | undefined {
  if (!parent?.children) return undefined;
  for (const sib of parent.children) {
    if (sib.id === excludeId) continue;
    if (sib.visible === false) continue;
    if (sib.type === "TEXT" && typeof sib.characters === "string") {
      const chars = sib.characters.trim();
      if (chars) return chars;
    }
  }
  return undefined;
}

/** Find an icon's labelling TEXT — first try direct siblings, then climb one
 *  level to grandparent's direct children (skipping the parent's own subtree).
 *  Catches the common pattern where a button is `[wrapper > vector] + TEXT`:
 *  the vector's direct sibling is empty, but the wrapper's sibling is the
 *  label. Climb is capped at 1 ancestor to avoid pulling labels from
 *  unrelated regions of the tree. */
function siblingLabel(
  fn: FigmaNode,
  parent: FigmaNode | undefined,
  grandparent?: FigmaNode,
): string | undefined {
  const direct = findTextSibling(parent, fn.id);
  if (direct) return direct;
  if (grandparent && parent) {
    return findTextSibling(grandparent, parent.id);
  }
  return undefined;
}

/**
 * Build the icon hint by reading the design context instead of the pixels.
 * Order of preference: own descriptive name → sibling TEXT label → parent's
 * descriptive name. Returns undefined when the node isn't icon-shaped or
 * when no signal is available — the agent gracefully falls back to the
 * file path / inline source.
 */
/**
 * Tag row-layout clusters that look like a button — text + (stroke OR fill) +
 * radius, sized within human-button bounds. Saves the renderer from inferring
 * "this is a button" from geometry every time. Conservative: only emits when
 * all signals align, so missing-button is preferred over false-positive.
 */
function inferPattern(
  fn: FigmaNode,
  node: PdsNode,
  layout: PdsLayout | undefined,
): string | undefined {
  // Use the literal layout (not the possibly-interned ref on node.layout).
  if (!layout || layout.flow !== "row") return undefined;
  const { w, h } = node.box;
  if (w < 40 || w > 480 || h < 20 || h > 80) return undefined;
  const hasVisual = Boolean(node.stroke || node.fill || node.fills);
  if (!hasVisual) return undefined;
  if (node.radius === undefined) return undefined;
  const labeled = (fn.children ?? []).some(
    (c) =>
      c.visible !== false &&
      c.type === "TEXT" &&
      typeof c.characters === "string" &&
      c.characters.trim().length > 0,
  );
  if (!labeled) return undefined;
  return "button";
}

function inferIconHint(
  fn: FigmaNode,
  parent: FigmaNode | undefined,
  grandparent: FigmaNode | undefined,
  ancestors: FigmaNode[],
  node: PdsNode,
): string | undefined {
  if (!isIconShaped(node, fn)) return undefined;
  if (isDescriptive(node.name ?? "")) {
    const own = cleanIconLabel(node.name ?? "");
    if (own) return own;
  }
  const label = siblingLabel(fn, parent, grandparent);
  if (label) return label;
  // Climb the ancestor chain, skipping generic names ("Group", "Frame 12",
  // "Vector") rather than stopping at the first non-descriptive container.
  // A real-world icon often lives 3–4 levels deep under generic wrappers
  // while the semantic name sits on a higher container ("Notifications",
  // "Settings"). Capped at 4 to avoid promoting an icon to a screen-level
  // label like "App / Workspace / Home".
  for (const anc of ancestors) {
    if (!isDescriptive(anc.name ?? "")) continue;
    const ancLabel = cleanIconLabel(anc.name ?? "");
    if (ancLabel) return ancLabel;
  }
  return undefined;
}

/**
 * Position of `child` relative to `parent`'s top-left, in CSS pixels. Returns
 * undefined when the parent's auto-layout resolves placement (so emitting x/y
 * would be redundant noise) or when bounding boxes are missing. The "Absolute
 * position" toggle on an auto-layout child surfaces as layoutPositioning ===
 * "ABSOLUTE" — we honour that override.
 */
function relativePos(
  parent: FigmaNode | undefined,
  child: FigmaNode,
): { x: number; y: number } | undefined {
  if (!parent) return undefined;
  const pbb = parent.absoluteBoundingBox;
  const cbb = child.absoluteBoundingBox;
  if (!pbb || !cbb) return undefined;
  const parentMode = parent.layoutMode;
  const autoLayoutParent = parentMode === "HORIZONTAL" || parentMode === "VERTICAL";
  const absoluteChild =
    (child as { layoutPositioning?: string }).layoutPositioning === "ABSOLUTE";
  if (autoLayoutParent && !absoluteChild) return undefined;
  return { x: round(cbb.x - pbb.x), y: round(cbb.y - pbb.y) };
}

/**
 * Figma stores "fully rounded" (pill / circle) as a sentinel integer that's
 * either far larger than any reasonable px value (`21243700`, `33990048`,
 * `105.157…` against a 60px tall pill) or any radius >= half the smaller box
 * dimension. Either way, CSS would round to a circle — surface that intent.
 */
function isFullRadius(r: number, box: { w: number; h: number }): boolean {
  if (!Number.isFinite(r) || r <= 0) return false;
  const minSide = Math.min(box.w, box.h);
  if (minSide > 0 && r >= minSide / 2) return true;
  return r >= 9999;
}

function cornerRadius(
  fn: FigmaNode,
  box: { w: number; h: number },
): number | "full" | [number, number, number, number] | undefined {
  if (fn.rectangleCornerRadii) {
    const [a, b, c, d] = fn.rectangleCornerRadii;
    if (a === b && b === c && c === d) {
      if (!a) return undefined;
      return isFullRadius(a, box) ? "full" : cleanPx(a);
    }
    const halfMin = Math.min(box.w, box.h) / 2;
    return fn.rectangleCornerRadii.map((r) =>
      cleanPx(isFullRadius(r, box) ? halfMin : r),
    ) as [number, number, number, number];
  }
  if (typeof fn.cornerRadius === "number") {
    if (!fn.cornerRadius) return undefined;
    return isFullRadius(fn.cornerRadius, box) ? "full" : cleanPx(fn.cornerRadius);
  }
  return undefined;
}

function buildNotes(fn: FigmaNode): string[] {
  const notes: string[] = [];
  if (fn.layoutMode && fn.layoutMode !== "NONE") {
    notes.push(`auto-layout ${fn.layoutMode}`);
  }
  if (fn.layoutSizingHorizontal === "FIXED") notes.push("fixed width");
  if (fn.layoutSizingHorizontal === "FILL") notes.push("fills width");
  if (fn.layoutSizingHorizontal === "HUG") notes.push("hugs contents");
  return notes;
}

/* ---------------------------------------------------------------------- */
/* v0.10 Phase 3 — fidelity helpers                                         */
/* ---------------------------------------------------------------------- */

/** Map Figma's blend mode enum to the CSS `mix-blend-mode` keyword. */
function cssBlendMode(figma: string): string | undefined {
  switch (figma) {
    case "PASS_THROUGH":
    case "NORMAL":
      return undefined;
    case "DARKEN": return "darken";
    case "MULTIPLY": return "multiply";
    case "LINEAR_BURN": return "plus-darker";
    case "COLOR_BURN": return "color-burn";
    case "LIGHTEN": return "lighten";
    case "SCREEN": return "screen";
    case "LINEAR_DODGE": return "plus-lighter";
    case "COLOR_DODGE": return "color-dodge";
    case "OVERLAY": return "overlay";
    case "SOFT_LIGHT": return "soft-light";
    case "HARD_LIGHT": return "hard-light";
    case "DIFFERENCE": return "difference";
    case "EXCLUSION": return "exclusion";
    case "HUE": return "hue";
    case "SATURATION": return "saturation";
    case "COLOR": return "color";
    case "LUMINOSITY": return "luminosity";
    default: return figma.toLowerCase();
  }
}

/** Compress Figma's textAutoResize enum into a 1-char-ish PDS hint. */
function pdsTextGrow(figma: string): "h" | "wh" | "trunc" | undefined {
  switch (figma) {
    case "HEIGHT": return "h";
    case "WIDTH_AND_HEIGHT": return "wh";
    case "TRUNCATE": return "trunc";
    default: return undefined; // NONE / unknown → omit
  }
}

/** Map a single Figma constraint enum to a CSS-shaped keyword. */
function pdsConstraint(figma: string | undefined, axis: "h" | "v"): string | undefined {
  if (!figma) return undefined;
  switch (figma) {
    case "MIN": return axis === "h" ? "left" : "top";
    case "MAX": return axis === "h" ? "right" : "bottom";
    case "CENTER": return "center";
    case "STRETCH": return "stretch";
    case "SCALE": return "scale";
    default: return undefined;
  }
}
