/**
 * Container-level semantic classification — the sibling of `inferPattern`'s
 * leaf-level "button" detection in normalize.ts. Runs once, after the full
 * tree (and repeat-group compression) is built, and tags `PdsNode.pattern`
 * with a small, deliberately narrow taxonomy of high-confidence structural
 * roles: nav / hero / footer / sidebar / card.
 *
 * Every rule is a conjunction of multiple structural signals already present
 * in the PDS (sibling order, box size relative to the root, repeat-group
 * templates, resolved text size) — no pixels, no network call, no LLM. Same
 * philosophy as `inferPattern`: a missed label costs nothing (the agent
 * falls back to raw geometry, today's behavior); a wrong label actively
 * misleads, so every rule prefers silence over a guess.
 *
 * Scope is intentionally the requested root's DIRECT children only — real
 * screens are almost always [Nav?, Hero, ...sections, Footer?] or
 * [Sidebar, Main] at that level, and reasoning about deeper nesting (a nav
 * bar inside a dashboard's main column, say) needs context this single-pass
 * classifier doesn't have. Under-labeling a nested nav is an acceptable
 * miss; mislabeling an unrelated frame is not.
 *
 * Deliberately NOT attempted here (tracked in ROADMAP-v0.14): "form" and
 * "modal" — both need signals (per-field grouping, prototype overlay
 * wiring) that are either unreliable from geometry alone or only present
 * when the file has authored prototype interactions.
 */
import type { PdsNode, TokenTable } from "../pds";
import { resolveLayout } from "./resolve";

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

export function classifySemantics(
  root: string,
  nodes: Record<string, PdsNode>,
  tokens: TokenTable,
): void {
  const rootNode = nodes[root];
  if (!rootNode) return;
  classifySections(rootNode, nodes, tokens);
  classifyCardTemplates(rootNode, nodes);
}

function children(node: PdsNode, nodes: Record<string, PdsNode>): PdsNode[] {
  return (node.children ?? [])
    .map((el) => nodes[el])
    .filter((n): n is PdsNode => n !== undefined);
}

function widthRatio(node: PdsNode, root: PdsNode): number {
  return root.box.w > 0 ? node.box.w / root.box.w : 0;
}

function heightRatio(node: PdsNode, root: PdsNode): number {
  return root.box.h > 0 ? node.box.h / root.box.h : 0;
}

/* ---------------------------------------------------------------------- */
/* nav / hero / footer / sidebar — direct children of the requested root   */
/* ---------------------------------------------------------------------- */

function classifySections(
  root: PdsNode,
  nodes: Record<string, PdsNode>,
  tokens: TokenTable,
): void {
  const kids = children(root, nodes);
  if (kids.length < 2) return; // need ≥2 sections to reason about order/edges

  const rootLayout = resolveLayout(root.layout, tokens);

  if (rootLayout?.flow === "col") {
    classifyVerticalStack(kids, root, nodes, tokens);
  } else if (rootLayout?.flow === "row") {
    classifySidebar(kids, root);
  } else {
    // Free canvas — no root auto-layout, so children carry absolute `pos`.
    // Vertical order comes from sorting by y; sidebar is an edge check, not
    // an order check, so it runs independently over the same set.
    const byY = [...kids].sort((a, b) => (a.pos?.y ?? 0) - (b.pos?.y ?? 0));
    classifyVerticalStack(byY, root, nodes, tokens);
    classifySidebar(kids, root);
  }
}

function classifyVerticalStack(
  ordered: PdsNode[],
  root: PdsNode,
  nodes: Record<string, PdsNode>,
  tokens: TokenTable,
): void {
  const first = ordered[0];
  if (!first) return;

  let heroStart = 0;
  if (
    !first.pattern &&
    widthRatio(first, root) >= NAV_MIN_WIDTH_RATIO &&
    first.box.h <= NAV_MAX_HEIGHT &&
    resolveLayout(first.layout, tokens)?.flow === "row" &&
    children(first, nodes).length >= 2
  ) {
    first.pattern = "nav";
    heroStart = 1;
  }

  const heroCandidate = ordered[heroStart];
  if (
    heroCandidate &&
    !heroCandidate.pattern &&
    widthRatio(heroCandidate, root) >= HERO_MIN_WIDTH_RATIO &&
    (heroCandidate.box.h >= HERO_MIN_HEIGHT ||
      heightRatio(heroCandidate, root) >= HERO_MIN_HEIGHT_RATIO) &&
    maxTextPx(heroCandidate, nodes, tokens, TEXT_SCAN_DEPTH) >= HERO_HEADLINE_MIN_PX
  ) {
    heroCandidate.pattern = "hero";
  }

  const last = ordered[ordered.length - 1];
  if (
    last &&
    last !== first &&
    !last.pattern &&
    widthRatio(last, root) >= FOOTER_MIN_WIDTH_RATIO &&
    heightRatio(last, root) <= FOOTER_MAX_HEIGHT_RATIO &&
    children(last, nodes).length >= 1
  ) {
    last.pattern = "footer";
  }
}

function classifySidebar(kids: PdsNode[], root: PdsNode): void {
  const candidates = [kids[0], kids[kids.length - 1]];
  for (const candidate of candidates) {
    if (!candidate || candidate.pattern) continue;
    if (
      widthRatio(candidate, root) <= SIDEBAR_MAX_WIDTH_RATIO &&
      candidate.box.w <= SIDEBAR_MAX_WIDTH &&
      heightRatio(candidate, root) >= SIDEBAR_MIN_HEIGHT_RATIO
    ) {
      candidate.pattern = "sidebar";
    }
  }
}

/** Largest resolved font size (px) among TEXT descendants within `depth`. */
function maxTextPx(
  node: PdsNode,
  nodes: Record<string, PdsNode>,
  tokens: TokenTable,
  depth: number,
): number {
  let max = 0;
  if (node.type === "text" && typeof node.text === "string") {
    const css = node.text.startsWith("$t") ? tokens.text[node.text] : node.text;
    const m = css?.match(/^\d+\s+([\d.]+)px/);
    if (m?.[1]) max = Math.max(max, parseFloat(m[1]));
  }
  if (depth > 0) {
    for (const child of children(node, nodes)) {
      max = Math.max(max, maxTextPx(child, nodes, tokens, depth - 1));
    }
  }
  return max;
}

/* ---------------------------------------------------------------------- */
/* card — repeat-group templates that look like a styled, labeled surface  */
/* ---------------------------------------------------------------------- */

function classifyCardTemplates(root: PdsNode, nodes: Record<string, PdsNode>): void {
  walkForRepeats(root, nodes, new Set<string>());
}

function walkForRepeats(
  node: PdsNode,
  nodes: Record<string, PdsNode>,
  seen: Set<string>,
): void {
  if (seen.has(node.el)) return;
  seen.add(node.el);

  const groups = node.repeat ? (Array.isArray(node.repeat) ? node.repeat : [node.repeat]) : [];
  for (const group of groups) {
    const template = nodes[group.template];
    if (template && !template.pattern && looksLikeCard(template, nodes)) {
      template.pattern = "card";
    }
  }

  for (const child of children(node, nodes)) walkForRepeats(child, nodes, seen);
}

/** A repeated frame that's a styled surface AND carries its own label. */
function looksLikeCard(node: PdsNode, nodes: Record<string, PdsNode>): boolean {
  const isSurface = Boolean(
    node.radius !== undefined ||
      node.shadow ||
      node.effects ||
      ((node.fill || node.fills) && node.stroke),
  );
  if (!isSurface) return false;
  return hasNonEmptyText(node, nodes, CARD_TEXT_SCAN_DEPTH);
}

function hasNonEmptyText(node: PdsNode, nodes: Record<string, PdsNode>, depth: number): boolean {
  if (node.type === "text") {
    if (typeof node.chars === "string") return node.chars.trim().length > 0;
    if (Array.isArray(node.chars)) return node.chars.length > 0;
    return false;
  }
  if (depth <= 0) return false;
  return children(node, nodes).some((c) => hasNonEmptyText(c, nodes, depth - 1));
}
