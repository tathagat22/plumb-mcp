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

/**
 * Every classifier below is a conjunction of hard gates (all signals must
 * pass, unchanged from the original ported classifier) — a strict AND gate
 * has no natural gradient to report as "confidence" on its own (every match
 * satisfies 100% of its required signals by definition). What DOES vary is
 * how comfortably each numeric threshold was cleared: a nav bar at 82% width
 * (barely over the 80% minimum) is a shakier read than one at 100%. This
 * scores that margin — 0.5 at the bare minimum (already a real, gate-passed
 * classification, not a coin flip; just the weakest form of one) rising to
 * 1.0 once the signal clears the threshold by 50%. Confidence for a
 * classification is the MINIMUM across its contributing signals — a chain
 * is only as confident as its weakest link.
 */
function marginConfidence(value: number, min: number, saturateAt: number = min * 1.5): number {
  if (min <= 0) return 1;
  const clamped = Math.max(min, Math.min(value, saturateAt));
  return saturateAt === min ? 1 : 0.5 + 0.5 * ((clamped - min) / (saturateAt - min));
}

/** Same as {@link marginConfidence} but for a signal that's inherently a
 *  0..1 ratio (widthRatio/heightRatio) — `min * 1.5` can exceed 1 and would
 *  make "100% width" read as less than fully confident. Saturates halfway
 *  between the minimum and the ratio's own ceiling of 1. */
function ratioConfidence(value: number, min: number): number {
  return marginConfidence(value, min, min + (1 - min) / 2);
}

/** Same idea for a "must stay under this ceiling" signal (e.g. footer must
 *  be a small fraction of the page) — margin grows as the value falls
 *  further below the max, saturating once it's at half the ceiling. */
function ceilingConfidence(value: number, max: number): number {
  if (max <= 0) return 1;
  const slack = (max - value) / max; // 0 right at the ceiling, 1 at value=0
  return 0.5 + 0.5 * Math.max(0, Math.min(1, slack / 0.5));
}

/* ---------------------------------------------------------------------- */
/* nav / hero / footer / sidebar — direct children of the requested root   */
/* ---------------------------------------------------------------------- */

interface Label {
  value: string;
  confidence: number;
}

function classifyVerticalStack(
  ordered: CirNode[],
  root: CirNode,
  graph: SemanticGraph,
  labels: Map<string, Label>,
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
    labels.set(first.id, {
      value: "nav",
      confidence: Math.min(
        ratioConfidence(widthRatio(first, root), NAV_MIN_WIDTH_RATIO),
        ceilingConfidence(first.box.h, NAV_MAX_HEIGHT),
      ),
    });
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
    labels.set(heroCandidate.id, {
      value: "hero",
      confidence: Math.min(
        ratioConfidence(widthRatio(heroCandidate, root), HERO_MIN_WIDTH_RATIO),
        Math.max(
          marginConfidence(heroCandidate.box.h, HERO_MIN_HEIGHT),
          ratioConfidence(heightRatio(heroCandidate, root), HERO_MIN_HEIGHT_RATIO),
        ),
        marginConfidence(maxTextPx(heroCandidate, graph, TEXT_SCAN_DEPTH), HERO_HEADLINE_MIN_PX),
      ),
    });
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
    labels.set(last.id, {
      value: "footer",
      confidence: Math.min(
        ratioConfidence(widthRatio(last, root), FOOTER_MIN_WIDTH_RATIO),
        ceilingConfidence(heightRatio(last, root), FOOTER_MAX_HEIGHT_RATIO),
      ),
    });
  }
}

function classifySidebar(kids: CirNode[], root: CirNode, labels: Map<string, Label>): void {
  for (const candidate of [kids[0], kids[kids.length - 1]]) {
    if (!candidate || labels.has(candidate.id)) continue;
    if (
      widthRatio(candidate, root) <= SIDEBAR_MAX_WIDTH_RATIO &&
      candidate.box.w <= SIDEBAR_MAX_WIDTH &&
      heightRatio(candidate, root) >= SIDEBAR_MIN_HEIGHT_RATIO
    ) {
      labels.set(candidate.id, {
        value: "sidebar",
        confidence: Math.min(
          ceilingConfidence(widthRatio(candidate, root), SIDEBAR_MAX_WIDTH_RATIO),
          ratioConfidence(heightRatio(candidate, root), SIDEBAR_MIN_HEIGHT_RATIO),
        ),
      });
    }
  }
}

function classifySections(graph: SemanticGraph, labels: Map<string, Label>): void {
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

const CARD_BASE_CONFIDENCE = 0.75; // isSurface + text are binary signals, not marginal thresholds

function classifyCardTemplates(graph: SemanticGraph, labels: Map<string, Label>): void {
  for (const edge of graph.edges) {
    if (edge.kind !== "repeats") continue;
    const template = graph.nodes[edge.to];
    if (!template || labels.has(template.id)) continue;
    if (template.style.isSurface && hasNonEmptyText(template, graph, CARD_TEXT_SCAN_DEPTH)) {
      labels.set(template.id, { value: "card", confidence: CARD_BASE_CONFIDENCE });
    }
  }
}

export const RoleEnricher: Enricher = {
  namespace: "role",
  version: VERSION,
  kind: "heuristic",
  // No dependencies — doesn't read prior annotations.
  run(graph: SemanticGraph): CirAnnotation[] {
    const labels = new Map<string, Label>();
    classifySections(graph, labels);
    classifyCardTemplates(graph, labels);
    return [...labels.entries()].map(([nodeId, label]) => ({
      nodeId,
      namespace: "role",
      version: VERSION,
      value: label.value,
      confidence: Math.round(label.confidence * 100) / 100,
    }));
  },
};
