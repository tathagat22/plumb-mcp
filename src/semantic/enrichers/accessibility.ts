/**
 * AccessibilityEnricher — docs/ROADMAP-v0.14-design-intelligence.md §10 M4.
 * Two checks, both heuristic and deterministic:
 *
 *  - contrast: walks the tree from root, carrying the nearest ancestor's
 *    resolved solid `fillColor` down as "the background behind this node"
 *    (root's own `fillColor`, if any, seeds the walk — no assumed default
 *    like white, because guessing a page background for a dark-mode design
 *    would be exactly the false-precision this codebase's other
 *    classifiers avoid). Only TEXT nodes with both a resolved own
 *    `fillColor` and a resolved ancestor background are checked; findings
 *    are emitted only for `wcagLevel === "fail"` — this is a heuristic
 *    *problem-finder*, not a full audit that reports every passing node.
 *  - touchTarget: `role:"button"` nodes under the 44×44px WCAG 2.5.5/2.5.8
 *    AA minimum.
 *
 * Scoped narrower than the roadmap's original one-line sketch
 * ("touch-target size on role:button/nav children"): checking `nav`'s
 * *children* would require identifying which of nav's children are
 * individually tappable, a heuristic this version doesn't attempt — nav
 * itself isn't a single tap target, so it's excluded rather than checked
 * incorrectly. Revisit once real usage shows it's worth the complexity.
 *
 * Heading-order sanity and a missing-alt-text signal (also named in the
 * roadmap's M4 sketch) are NOT built here — deferred, not silently
 * dropped: heading-order needs a documented notion of "heading" that
 * doesn't exist yet (font-size-relative-to-siblings inside a hero is a
 * weaker signal than a dedicated `role:"heading"`, which nothing produces
 * today), and missing-alt is nearly free once M1's `iconHint` field is
 * read from the source `PdsNode` — worth doing, but as its own small
 * addition with its own tests, not folded in here to hit a milestone
 * checklist.
 */
import type { CirAnnotation, CirNode, SemanticGraph } from "../graph";
import type { Enricher } from "../enricher";
import { contrastRatio, parseHexColor, wcagLevel } from "./contrastMath";
import type { WcagLevel } from "./contrastMath";

const VERSION = "1.0.0";
const LARGE_TEXT_MIN_PX = 24;
const TOUCH_TARGET_MIN_PX = 44; // WCAG 2.5.5 / 2.5.8 AA minimum target size

export type A11yFinding =
  | {
      kind: "contrast";
      ratio: number;
      level: WcagLevel;
      foreground: string;
      background: string;
      isLargeText: boolean;
    }
  | { kind: "touchTarget"; box: { w: number; h: number }; minRequired: number };

function children(node: CirNode, graph: SemanticGraph): CirNode[] {
  return node.children.map((el) => graph.nodes[el]).filter((n): n is CirNode => n !== undefined);
}

function checkContrast(
  nodeId: string,
  graph: SemanticGraph,
  backgroundHex: string | undefined,
  out: CirAnnotation[],
): void {
  const node = graph.nodes[nodeId];
  if (!node) return;

  if (node.kind === "text" && node.style.fillColor && backgroundHex) {
    const fg = parseHexColor(node.style.fillColor);
    const bg = parseHexColor(backgroundHex);
    if (fg && bg) {
      const ratio = contrastRatio(fg, bg);
      const isLargeText = (node.style.textPx ?? 0) >= LARGE_TEXT_MIN_PX;
      const level = wcagLevel(ratio, isLargeText);
      if (level === "fail") {
        const value: A11yFinding = {
          kind: "contrast",
          ratio: Math.round(ratio * 100) / 100,
          level,
          foreground: node.style.fillColor,
          background: backgroundHex,
          isLargeText,
        };
        out.push({ nodeId, namespace: "a11y", version: VERSION, value });
      }
    }
  }

  // Text nodes are leaves in practice; the background carried down to any
  // (unexpected) children is unaffected by a text node's own fill.
  const nextBackground = node.kind === "text" ? backgroundHex : (node.style.fillColor ?? backgroundHex);
  for (const child of children(node, graph)) checkContrast(child.id, graph, nextBackground, out);
}

function checkTouchTargets(roleByNode: Map<string, string>, graph: SemanticGraph, out: CirAnnotation[]): void {
  for (const [nodeId, role] of roleByNode) {
    if (role !== "button") continue;
    const node = graph.nodes[nodeId];
    if (!node) continue;
    if (node.box.w < TOUCH_TARGET_MIN_PX || node.box.h < TOUCH_TARGET_MIN_PX) {
      const value: A11yFinding = { kind: "touchTarget", box: node.box, minRequired: TOUCH_TARGET_MIN_PX };
      out.push({ nodeId, namespace: "a11y", version: VERSION, value });
    }
  }
}

export const AccessibilityEnricher: Enricher = {
  namespace: "a11y",
  version: VERSION,
  kind: "heuristic",
  requires: ["role"],
  // Defaults to [] even though this enricher declares `requires: ["role"]`
  // (and so, in practice, always runs through `runEnrichers`, which always
  // passes the accumulated list) — the `Enricher` interface itself makes
  // this parameter optional, and a direct call through that interface type
  // must not crash just because it omitted an optional argument.
  run(graph: SemanticGraph, priorAnnotations: CirAnnotation[] = []): CirAnnotation[] {
    const out: CirAnnotation[] = [];

    const rootNode = graph.nodes[graph.root];
    checkContrast(graph.root, graph, rootNode?.style.fillColor, out);

    const roleByNode = new Map(
      priorAnnotations.filter((a) => a.namespace === "role").map((a) => [a.nodeId, String(a.value)]),
    );
    checkTouchTargets(roleByNode, graph, out);

    return out;
  },
};
