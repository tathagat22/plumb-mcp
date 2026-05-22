import { HandleMinter } from "./handles";
import { toLayout } from "./layout";
import { TokenInterner } from "./tokens";
import { estimateTokens } from "../util/estimate";
import { round } from "../util/num";
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

  function walk(fn: FigmaNode, level: number): string | undefined {
    // Prune invisible nodes — but never the requested root (level 0).
    if (level > 0 && fn.visible === false) return undefined;

    const el = minter.mint(fn.name ?? "", fn.type ?? "");
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

    const layout = toLayout(fn);
    if (layout) node.layout = layout;

    const fill = interner.internColor(fn.fills);
    if (fill) node.fill = fill;

    const stroke = interner.internColor(fn.strokes);
    if (stroke) {
      node.stroke = stroke;
      if (fn.strokeWeight) node.strokeW = fn.strokeWeight;
    }

    const radius = cornerRadius(fn);
    if (typeof radius === "number") {
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
        const childEl = walk(child, level + 1);
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

function cornerRadius(
  fn: FigmaNode,
): number | [number, number, number, number] | undefined {
  if (fn.rectangleCornerRadii) {
    const [a, b, c, d] = fn.rectangleCornerRadii;
    if (a === b && b === c && c === d) return a || undefined;
    return fn.rectangleCornerRadii;
  }
  if (typeof fn.cornerRadius === "number") return fn.cornerRadius || undefined;
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
