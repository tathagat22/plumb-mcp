import { REPEAT_MIN, compressRepeats } from "./repeats";
import {
  childSizing,
  inlineVectorPath,
  normalizeComponentProps,
  normalizeLayoutAlign,
  normalizeMaskType,
  normalizeStrokeAlign,
  perSideStrokeWidths,
} from "./nodeProps";
import { motionFromReactions } from "./motion";
import { inferIconHint, inferPattern, isDescriptive } from "./icons";
import {
  buildNotes,
  cornerRadius,
  cssBlendMode,
  pdsConstraint,
  pdsTextCase,
  pdsTextGrow,
  relativePos,
} from "./fidelity";
import { HandleMinter } from "./handles";
import { toLayout } from "./layout";
import { backdropFilterCss, effectsToStack, paintsToFillStack } from "./paint";
import { TokenInterner } from "./tokens";
import { applySemanticEnrichers } from "../semantic";
import { detectSuspiciousText } from "./typo";
import { estimateTokens } from "../util/estimate";
import { cleanPx, round } from "../util/num";
import type { FigmaFileResult, FigmaNode } from "../figma/types";
import { PDS_SCHEMA_VERSION } from "../pds";
import type { Fill, PdsDocument, PdsNode } from "../pds";

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
  //
  // This walks the ENTIRE tree regardless of the requested `depth` (that's
  // the whole point — handle stability across depth-step retries, see the
  // doc comment above), so unlike `walk()` below there's no depth parameter
  // to bound recursion with. An explicit stack (not the call stack) is used
  // instead, so a pathological/adversarial file (deeply nested `.fig`
  // import, malformed REST payload) degrades to "just runs a while" rather
  // than a `RangeError: Maximum call stack size exceeded` crash. Pushing
  // children in reverse preserves the same left-to-right pre-order handle
  // assignment sequence the recursive version produced.
  const stack: { node: FigmaNode; level: number }[] = [{ node: file.document, level: 0 }];
  while (stack.length > 0) {
    const { node: fn, level } = stack.pop()!;
    if (level > 0 && fn.visible === false) continue;
    elById.set(fn.id, minter.mint(fn.name ?? "", fn.type ?? ""));
    const kids = (fn.children ?? []).filter((k) => k.visible !== false);
    for (let i = kids.length - 1; i >= 0; i--) {
      stack.push({ node: kids[i]!, level: level + 1 });
    }
  }
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

    if (fn.type === "BOOLEAN_OPERATION" && fn.booleanOperation) {
      node.boolOp = fn.booleanOperation.toLowerCase() as PdsNode["boolOp"];
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
      const textCase = pdsTextCase(fn.style?.textCase);
      if (textCase) node.textCase = textCase;

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
          const tcRun = pdsTextCase(r.style?.textCase);
          const out: import("../pds").PdsTextRun = { t: r.characters };
          // Only emit overrides — agents reconstruct by inheriting from
          // the node's dominant style/fill/decoration when these are absent.
          if (sRef && sRef !== text) out.s = sRef;
          if (cRef && cRef !== dominantFill) out.c = cRef;
          if (dRun && dRun !== node.textDecoration) out.d = dRun;
          if (tcRun && tcRun !== node.textCase) out.tc = tcRun;
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

  // Count top-level image asset nodes so the `next` hint can tell the agent
  // to download them before generating HTML. Without this, agents skip
  // plumb_assets and fall back to placeholders, which tanks the verify score.
  const assetCount = Object.values(nodes).filter((n) => n.assetId).length;

  const doc: PdsDocument = {
    schemaVersion: PDS_SCHEMA_VERSION,
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
      "call plumb_node again on that node's `id` to expand them." +
      (assetCount > 0
        ? ` This screen has ${assetCount} image asset(s) (nodes with \`assetId\`). ` +
          "Call plumb_assets with this screen's id to download them to disk BEFORE " +
          "generating HTML — without the real files any <img> will be a placeholder " +
          "and plumb_verify will flag every image node as asset.missing."
        : ""),
  };

  const suspicious = detectSuspiciousText(nodes);
  if (suspicious.length) doc.meta.suspiciousText = suspicious;

  if (opts.maxTokens && estTokens > opts.maxTokens) {
    doc.meta.truncated = true;
    doc.meta.hint =
      `Response is ~${estTokens} tokens, over the ${opts.maxTokens} budget. ` +
      "Re-call plumb_node with a smaller `depth`, or on a specific child `el`.";
  }

  // Semantic Graph pass — builds a platform-agnostic CIR from this now-
  // complete document, runs the enricher registry (currently just role
  // classification), and projects the result back onto `pattern`. See
  // src/semantic/index.ts and docs/ROADMAP-v0.14-design-intelligence.md §10 M2.
  applySemanticEnrichers(doc);

  return doc;
}
