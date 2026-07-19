/**
 * Source Graph → Semantic Graph. The only place PDS/Figma-shaped knowledge
 * (token refs, `PdsNode` field layout) is allowed to leak into the semantic
 * layer — every enricher downstream reads `SemanticGraph` only. This is the
 * concrete fix for "should the parser know about semantics / should
 * reasoning know about Figma" (docs/ROADMAP-v0.14-design-intelligence.md
 * §2, §7): neither does. This file is the seam between them.
 */
import type { PdsDocument, PdsNode } from "../pds";
import { resolveFills, resolveLayout } from "../normalize/resolve";
import type { CirEdge, CirNode, CirNodeStyle, NodeKind, SemanticGraph } from "./graph";

const CIR_VERSION = "1.0.0";

const VECTOR_TYPES = new Set(["vector", "bool", "star", "polygon", "line"]);

function kindOf(node: PdsNode): NodeKind {
  if (node.assetId) return "image";
  if (node.type === "text") return "text";
  if (node.type === "instance") return "componentInstance";
  if (VECTOR_TYPES.has(node.type)) return "vector";
  // Frames, groups, rects, ellipses, sections, and component/component-set
  // DEFINITIONS (as opposed to instances, which are rare in extracted
  // subtrees) all read as a generic bounded container.
  return "container";
}

/** Largest resolved font-size (px) directly on this text node, if any. */
function textPxOf(node: PdsNode, doc: PdsDocument): number | undefined {
  if (node.type !== "text" || typeof node.text !== "string") return undefined;
  const css = node.text.startsWith("$t") ? doc.tokens.text[node.text] : node.text;
  const m = css?.match(/^\d+\s+([\d.]+)px/);
  return m?.[1] ? parseFloat(m[1]) : undefined;
}

/** Radius, shadow/effects, or a fill+stroke pair — a bounded styled surface. */
function isSurface(node: PdsNode): boolean {
  return Boolean(
    node.radius !== undefined ||
      node.shadow ||
      node.effects ||
      ((node.fill || node.fills) && node.stroke),
  );
}

function resolveColorRef(ref: string | undefined, doc: PdsDocument): string | undefined {
  if (!ref) return undefined;
  return ref.startsWith("$c") ? doc.tokens.color[ref] : ref;
}

/** The node's own resolved solid color, own fill only (no ancestor walk —
 *  see CirNodeStyle.fillColor's docstring for why). Undefined for
 *  multi-layer stacks, gradients, and images — a "the" color doesn't exist
 *  for those, and guessing one would be exactly the kind of false-precision
 *  this codebase's classifiers otherwise avoid. */
function fillColorOf(node: PdsNode, doc: PdsDocument): string | undefined {
  const fills = resolveFills(node.fills, doc.tokens);
  if (fills) {
    if (fills.length === 1 && fills[0]?.type === "color") return fills[0].color;
    return undefined; // 0 or ≥2 layers, or a non-solid single layer — ambiguous
  }
  if (typeof node.fill === "string" && node.fill !== "gradient" && node.fill !== "image") {
    return resolveColorRef(node.fill, doc);
  }
  if (typeof node.inheritedFill === "string") return resolveColorRef(node.inheritedFill, doc);
  return undefined;
}

function styleOf(node: PdsNode, doc: PdsDocument): CirNodeStyle {
  const style: CirNodeStyle = {};
  const layout = resolveLayout(node.layout, doc.tokens);
  if (layout) style.layout = layout;
  const textPx = textPxOf(node, doc);
  if (textPx !== undefined) style.textPx = textPx;
  if (isSurface(node)) style.isSurface = true;
  const fillColor = fillColorOf(node, doc);
  if (fillColor) style.fillColor = fillColor;
  return style;
}

function charsOf(node: PdsNode): string | undefined {
  if (node.type !== "text") return undefined;
  if (typeof node.chars === "string") return node.chars;
  if (Array.isArray(node.chars)) return node.chars.map((r) => r.t).join("");
  return undefined;
}

export function buildSemanticGraph(doc: PdsDocument): SemanticGraph {
  const nodes: Record<string, CirNode> = {};
  const edges: CirEdge[] = [];

  for (const [el, node] of Object.entries(doc.nodes)) {
    const children = node.children ?? [];
    nodes[el] = {
      id: el,
      kind: kindOf(node),
      box: node.box,
      pos: node.pos,
      children,
      chars: charsOf(node),
      style: styleOf(node, doc),
      sourceRef: { adapter: "figma", nativeId: node.id },
    };

    for (const child of children) edges.push({ from: el, to: child, kind: "contains" });

    if (node.component) {
      const componentId = typeof node.component === "string" ? node.component : node.component.id;
      const variant = typeof node.component === "object" ? node.component.variant : undefined;
      edges.push({ from: el, to: componentId, kind: "instanceOf", meta: variant ? { variant } : undefined });
    }

    const groups = node.repeat ? (Array.isArray(node.repeat) ? node.repeat : [node.repeat]) : [];
    for (const group of groups) {
      edges.push({ from: el, to: group.template, kind: "repeats" });
    }
  }

  return { cirVersion: CIR_VERSION, root: doc.root, nodes, edges };
}
