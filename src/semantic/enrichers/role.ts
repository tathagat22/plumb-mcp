/**
 * RoleEnricher — container-level semantic roles: nav / hero / footer /
 * sidebar / card. Ported near-unchanged from the first-shipped classifier
 * (`src/normalize/semantics.ts`, now removed) per
 * docs/ROADMAP-v0.14-design-intelligence.md §10 M2. The classification
 * rules themselves are UNCHANGED — same thresholds, same conjunction-of-
 * signals, same "abstain over guess" discipline. What changed is the
 * substrate: this reads a `SemanticGraph` (already-resolved `style.layout`
 * / `style.textPx` / `style.isSurface`, `repeats` edges instead of a
 * `PdsRepeatGroup` field walk) instead of `PdsNode` + a live `TokenTable` —
 * so this file has zero knowledge of PDS, Figma, or token refs. Compare to
 * the removed file's imports of `resolveLayout` from the normalize layer;
 * this one imports only from `../graph`.
 *
 * Scope is still the requested root's DIRECT children for nav/hero/footer/
 * sidebar, and repeat-group templates anywhere for card. `form` and
 * `modal` remain deliberately unattempted — see the roadmap doc.
 */
import type { CirAnnotation, CirNode, SemanticGraph } from "../graph";
import type { Enricher } from "../enricher";

const NAV_MAX_HEIGHT = 140;
const NAV_MIN_WIDTH_RATIO = 0.8;
const HERO_MIN_WIDTH_RATIO = 0.8;
const HERO_MIN_HEIGHT = 240;
const HERO_MIN_HEIGHT_RATIO = 0.25;
const HERO_HEADLINE_MIN_PX = 28;
const FOOTER_MIN_WIDTH_RATIO = 0.8;
const FOOTER_MAX_HEIGHT_RATIO = 0.3;
const SIDEBAR_MAX_WIDTH_RATIO = 0.4;
const SIDEBAR_MAX_WIDTH = 420;
const SIDEBAR_MIN_HEIGHT_RATIO = 0.6;
const TEXT_SCAN_DEPTH = 3;
const CARD_TEXT_SCAN_DEPTH = 4;
const VERSION = "1.0.0";

function children(node: CirNode, graph: SemanticGraph): CirNode[] {
  return node.children.map((el) => graph.nodes[el]).filter((n): n is CirNode => n !== undefined);
}

function widthRatio(node: CirNode, root: CirNode): number {
  return root.box.w > 0 ? node.box.w / root.box.w : 0;
}

function heightRatio(node: CirNode, root: CirNode): number {
  return root.box.h > 0 ? node.box.h / root.box.h : 0;
}

function maxTextPx(node: CirNode, graph: SemanticGraph, depth: number): number {
  let max = node.style.textPx ?? 0;
  if (depth > 0) {
    for (const child of children(node, graph)) max = Math.max(max, maxTextPx(child, graph, depth - 1));
  }
  return max;
}

function hasNonEmptyText(node: CirNode, graph: SemanticGraph, depth: number): boolean {
  if (node.kind === "text") return Boolean(node.chars && node.chars.trim().length > 0);
  if (depth <= 0) return false;
  return children(node, graph).some((c) => hasNonEmptyText(c, graph, depth - 1));
}

/* ---------------------------------------------------------------------- */
/* nav / hero / footer / sidebar — direct children of the requested root   */
/* ---------------------------------------------------------------------- */

function classifyVerticalStack(
  ordered: CirNode[],
  root: CirNode,
  graph: SemanticGraph,
  labels: Map<string, string>,
): void {
  const first = ordered[0];
  if (!first) return;

  let heroStart = 0;
  if (
    !labels.has(first.id) &&
    widthRatio(first, root) >= NAV_MIN_WIDTH_RATIO &&
    first.box.h <= NAV_MAX_HEIGHT &&
    first.style.layout?.flow === "row" &&
    children(first, graph).length >= 2
  ) {
    labels.set(first.id, "nav");
    heroStart = 1;
  }

  const heroCandidate = ordered[heroStart];
  if (
    heroCandidate &&
    !labels.has(heroCandidate.id) &&
    widthRatio(heroCandidate, root) >= HERO_MIN_WIDTH_RATIO &&
    (heroCandidate.box.h >= HERO_MIN_HEIGHT || heightRatio(heroCandidate, root) >= HERO_MIN_HEIGHT_RATIO) &&
    maxTextPx(heroCandidate, graph, TEXT_SCAN_DEPTH) >= HERO_HEADLINE_MIN_PX
  ) {
    labels.set(heroCandidate.id, "hero");
  }

  const last = ordered[ordered.length - 1];
  if (
    last &&
    last !== first &&
    !labels.has(last.id) &&
    widthRatio(last, root) >= FOOTER_MIN_WIDTH_RATIO &&
    heightRatio(last, root) <= FOOTER_MAX_HEIGHT_RATIO &&
    children(last, graph).length >= 1
  ) {
    labels.set(last.id, "footer");
  }
}

function classifySidebar(kids: CirNode[], root: CirNode, labels: Map<string, string>): void {
  for (const candidate of [kids[0], kids[kids.length - 1]]) {
    if (!candidate || labels.has(candidate.id)) continue;
    if (
      widthRatio(candidate, root) <= SIDEBAR_MAX_WIDTH_RATIO &&
      candidate.box.w <= SIDEBAR_MAX_WIDTH &&
      heightRatio(candidate, root) >= SIDEBAR_MIN_HEIGHT_RATIO
    ) {
      labels.set(candidate.id, "sidebar");
    }
  }
}

function classifySections(graph: SemanticGraph, labels: Map<string, string>): void {
  const root = graph.nodes[graph.root];
  if (!root) return;
  const kids = children(root, graph);
  if (kids.length < 2) return;

  if (root.style.layout?.flow === "col") {
    classifyVerticalStack(kids, root, graph, labels);
  } else if (root.style.layout?.flow === "row") {
    classifySidebar(kids, root, labels);
  } else {
    const byY = [...kids].sort((a, b) => (a.pos?.y ?? 0) - (b.pos?.y ?? 0));
    classifyVerticalStack(byY, root, graph, labels);
    classifySidebar(kids, root, labels);
  }
}

/* ---------------------------------------------------------------------- */
/* card — repeat-group templates that look like a styled, labeled surface  */
/* ---------------------------------------------------------------------- */

function classifyCardTemplates(graph: SemanticGraph, labels: Map<string, string>): void {
  for (const edge of graph.edges) {
    if (edge.kind !== "repeats") continue;
    const template = graph.nodes[edge.to];
    if (!template || labels.has(template.id)) continue;
    if (template.style.isSurface && hasNonEmptyText(template, graph, CARD_TEXT_SCAN_DEPTH)) {
      labels.set(template.id, "card");
    }
  }
}

export const RoleEnricher: Enricher = {
  namespace: "role",
  version: VERSION,
  kind: "heuristic",
  // No dependencies — doesn't read prior annotations.
  run(graph: SemanticGraph): CirAnnotation[] {
    const labels = new Map<string, string>();
    classifySections(graph, labels);
    classifyCardTemplates(graph, labels);
    return [...labels.entries()].map(([nodeId, value]) => ({
      nodeId,
      namespace: "role",
      version: VERSION,
      value,
    }));
  },
};
