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
import type { Fill, MotionSpec, PdsDocument, PdsNode } from "../pds";

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
  const minter = new HandleMinter();
  const nodes: Record<string, PdsNode> = {};

  // Pre-pass: walk the entire visible tree (ignoring `depth`) so every node
  // gets its el assigned in a deterministic, depth-independent order. Without
  // this, a deeper walk visits more sibling/descendant nodes named "vector"
  // or "group" between two same-named cousins, shifting which one gets the
  // un-suffixed handle — which broke plumb_verify across different depths.
  const elById = new Map<string, string>();
  function preWalk(fn: FigmaNode, level: number): void {
    if (level > 0 && fn.visible === false) return;
    elById.set(fn.id, minter.mint(fn.name ?? "", fn.type ?? ""));
    const kids = (fn.children ?? []).filter((k) => k.visible !== false);
    for (const child of kids) preWalk(child, level + 1);
  }
  preWalk(file.document, 0);

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
  ): string | undefined {
    // Prune invisible nodes — but never the requested root (level 0).
    if (level > 0 && fn.visible === false) return undefined;

    const el = elById.get(fn.id) ?? minter.mint(fn.name ?? "", fn.type ?? "");
    const path = parentPath ? `${parentPath}.${el}` : el;
    const node: PdsNode = {
      id: fn.id,
      el,
      name: fn.name ?? "",
      type: TYPE_MAP[fn.type] ?? fn.type.toLowerCase(),
      box: {
        w: round(fn.absoluteBoundingBox?.width ?? 0),
        h: round(fn.absoluteBoundingBox?.height ?? 0),
      },
    };
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
      node.layout = layout;
      // Emit contentMain when justify is set and visible children sit shorter
      // than the container — the slack is what justify distributes. Agents
      // were guessing-and-screenshotting to confirm this; the number kills
      // the round-trip.
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
          // Only emit when there's at least 4px of slack — within that the
          // agent's naive flex assumption is already correct.
          if (available - contentMain >= 4) layout.contentMain = contentMain;
        }
      }
    }

    const fill = interner.internColor(fn.fills);
    if (fill) node.fill = fill;

    // Full fill stack — the smoking-gun fix for "20% white" being a
    // multi-fill glass treatment, or "gradient" being a stop-less placeholder.
    const fills = paintsToFillStack(fn.fills);
    if (fills) {
      node.fills = fills;
      const firstImage = fills.find((f): f is Fill & { type: "image" } => f.type === "image");
      if (firstImage && firstImage.assetId) node.assetId = firstImage.assetId;
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

    const iconHint = inferIconHint(fn, parent, grandparent, node);
    if (iconHint) node.iconHint = iconHint;

    const pattern = inferPattern(fn, node);
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

    const shadow = interner.internShadow(fn.effects);
    if (shadow) node.shadow = shadow;
    const effects = effectsToStack(fn.effects);
    if (effects) node.effects = effects;
    const backdrop = backdropFilterCss(fn.effects);
    if (backdrop) node.backdropFilter = backdrop;

    if (fn.opacity != null && fn.opacity < 1) node.opacity = round(fn.opacity, 2);
    if (fn.clipsContent) node.clip = true;

    if (fn.isMask === true) {
      node.isMask = true;
      const mode = normalizeMaskType(fn.maskType);
      if (mode) node.maskMode = mode;
    }

    if (fn.type === "TEXT") {
      const text = interner.internText(fn.style);
      if (text) node.text = text;
      if (typeof fn.characters === "string") node.chars = fn.characters;
      const dec = fn.style?.textDecoration;
      if (dec === "UNDERLINE") node.textDecoration = "underline";
      else if (dec === "STRIKETHROUGH") node.textDecoration = "line-through";
    }

    if (fn.type === "INSTANCE" && typeof fn.componentId === "string") {
      node.component = fn.componentId;
    }

    const motion = motionFromReactions(fn.reactions);
    if (motion) node.motion = motion;

    if (opts.notes) {
      const notes = buildNotes(fn);
      if (notes.length) node.notes = notes;
    }

    // Progressive disclosure (plan §5/§7): expand children only while above the
    // disclosure depth. At the boundary, record how many children exist via
    // `more` so the agent knows to drill in with another plumb_node call.
    const kids = (fn.children ?? []).filter((k) => k.visible !== false);
    if (level >= depth) {
      if (kids.length) node.more = kids.length;
    } else {
      const childEls: string[] = [];
      // A mask child shapes every later sibling inside the same container
      // (Figma's `isMask` semantics). Track the most recent mask el and tag
      // subsequent siblings with `masked` so the renderer can apply the
      // mask's fills as CSS `mask-image` instead of drawing it standalone.
      let currentMaskEl: string | undefined;
      for (const child of kids) {
        const childEl = walk(child, level + 1, fn, path, fillForChildren, parent);
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
function inferPattern(fn: FigmaNode, node: PdsNode): string | undefined {
  if (!node.layout || node.layout.flow !== "row") return undefined;
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
  node: PdsNode,
): string | undefined {
  if (!isIconShaped(node, fn)) return undefined;
  if (isDescriptive(node.name)) {
    const own = cleanIconLabel(node.name);
    if (own) return own;
  }
  const label = siblingLabel(fn, parent, grandparent);
  if (label) return label;
  if (parent && isDescriptive(parent.name ?? "")) {
    const p = cleanIconLabel(parent.name ?? "");
    if (p) return p;
  }
  if (grandparent && isDescriptive(grandparent.name ?? "")) {
    const g = cleanIconLabel(grandparent.name ?? "");
    if (g) return g;
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
