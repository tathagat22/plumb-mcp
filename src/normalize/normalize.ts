import { HandleMinter } from "./handles";
import { toLayout } from "./layout";
import { TokenInterner } from "./tokens";
import { estimateTokens } from "../util/estimate";
import { cleanPx, round } from "../util/num";
import type { FigmaFileResult, FigmaNode } from "../figma/types";
import type { PdsDocument, PdsNode } from "../pds";

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

  function walk(fn: FigmaNode, level: number, parent?: FigmaNode): string | undefined {
    // Prune invisible nodes — but never the requested root (level 0).
    if (level > 0 && fn.visible === false) return undefined;

    const el = elById.get(fn.id) ?? minter.mint(fn.name ?? "", fn.type ?? "");
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

    const pos = relativePos(parent, fn);
    if (pos) node.pos = pos;

    const layout = toLayout(fn);
    if (layout) node.layout = layout;

    const fill = interner.internColor(fn.fills);
    if (fill) node.fill = fill;

    const iconHint = inferIconHint(fn, parent, node);
    if (iconHint) node.iconHint = iconHint;

    const stroke = interner.internColor(fn.strokes);
    if (stroke) {
      node.stroke = stroke;
      if (fn.strokeWeight) {
        const w = cleanPx(fn.strokeWeight);
        if (w) node.strokeW = w;
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

    if (fn.opacity != null && fn.opacity < 1) node.opacity = round(fn.opacity, 2);
    if (fn.clipsContent) node.clip = true;

    if (fn.type === "TEXT") {
      const text = interner.internText(fn.style);
      if (text) node.text = text;
      if (typeof fn.characters === "string") node.chars = fn.characters;
    }

    if (fn.type === "INSTANCE" && typeof fn.componentId === "string") {
      node.component = fn.componentId;
    }

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
      for (const child of kids) {
        const childEl = walk(child, level + 1, fn);
        if (childEl) childEls.push(childEl);
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

  if (opts.maxTokens && estTokens > opts.maxTokens) {
    doc.meta.truncated = true;
    doc.meta.hint =
      `Response is ~${estTokens} tokens, over the ${opts.maxTokens} budget. ` +
      "Re-call plumb_node with a smaller `depth`, or on a specific child `el`.";
  }

  return doc;
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

/** First TEXT sibling under the same parent with non-empty characters. */
function siblingLabel(fn: FigmaNode, parent: FigmaNode | undefined): string | undefined {
  if (!parent?.children) return undefined;
  for (const sib of parent.children) {
    if (sib.id === fn.id) continue;
    if (sib.visible === false) continue;
    if (sib.type === "TEXT" && typeof sib.characters === "string") {
      const chars = sib.characters.trim();
      if (chars) return chars;
    }
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
function inferIconHint(
  fn: FigmaNode,
  parent: FigmaNode | undefined,
  node: PdsNode,
): string | undefined {
  if (!isIconShaped(node, fn)) return undefined;
  if (isDescriptive(node.name)) {
    const own = cleanIconLabel(node.name);
    if (own) return own;
  }
  const label = siblingLabel(fn, parent);
  if (label) return label;
  if (parent && isDescriptive(parent.name ?? "")) {
    const p = cleanIconLabel(parent.name ?? "");
    if (p) return p;
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
