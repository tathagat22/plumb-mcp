/**
 * Semantic-aware compression (v2) — docs/ROADMAP-v0.14-design-intelligence.md
 * §10 M6. Depth truncation (`more`) and repeat-group compression already
 * shrink a response by structural rules; this adds a third, orthogonal one
 * triggered by a confident semantic role instead of a depth boundary or a
 * repeated sibling: collapse a `role`-matched subtree the caller explicitly
 * named to a one-line `summary` + the same `more` contract already used for
 * depth truncation, deleting the now-redundant descendant entries from
 * `nodes` (the actual token savings, not just a display trick).
 *
 * Opt-in, not automatic — `docs/ROADMAP-v0.14-design-intelligence.md`'s own
 * cost-transparency principle (§3.5): a caller can predict what a call
 * returns before making it. Silently guessing that an agent doesn't need a
 * footer's contents (it might, for an accessibility or copy-review task)
 * would violate that; naming the roles to collapse keeps the caller in
 * control and the summary is deterministic/structural (box size, child
 * count, up to 3 child descriptors) — never fabricated content.
 *
 * This is a PROJECTION-layer transform of an already-built `PdsDocument`
 * (itself a projection of the Semantic Graph), operating on `pattern` and
 * `children` only — it doesn't need the `SemanticGraph`/CIR itself, which
 * is why it lives in `project/` rather than `enrichers/`.
 */
import { estimateTokens } from "../../util/estimate";
import type { PdsDocument, PdsNode } from "../../pds";

function shortDescriptor(node: PdsNode): string {
  if (node.pattern) return node.pattern;
  if (node.type === "text") {
    const chars = typeof node.chars === "string" ? node.chars : Array.isArray(node.chars) ? node.chars.map((r) => r.t).join("") : undefined;
    if (chars?.trim()) return `text "${chars.length > 24 ? `${chars.slice(0, 24)}…` : chars}"`;
  }
  return node.name ?? node.type;
}

function summarize(node: PdsNode, nodes: Record<string, PdsNode>): string {
  const label = node.pattern ?? node.type;
  const kidEls = node.children ?? [];
  const kids = kidEls.map((el) => nodes[el]).filter((n): n is PdsNode => n !== undefined);
  const shown = kids.slice(0, 3).map(shortDescriptor);
  const suffix = kids.length > shown.length ? ", …" : "";
  const childList = shown.length ? ` (${shown.join(", ")}${suffix})` : "";
  const childWord = kidEls.length === 1 ? "child" : "children";
  return `${label} — ${node.box.w}×${node.box.h}px, ${kidEls.length} ${childWord}${childList}`;
}

/** Deletes a subtree's entries from `nodes` (the actual byte savings —
 *  mirrors `deleteSubtree` in `src/normalize/normalize.ts`'s repeat-group
 *  compression, reimplemented locally rather than imported: that function
 *  is private to the parse layer, and this is a projection-layer concern
 *  operating on the already-built wire document, not the parse walk. */
function deleteSubtree(el: string, nodes: Record<string, PdsNode>): void {
  const n = nodes[el];
  if (!n) return;
  for (const c of n.children ?? []) deleteSubtree(c, nodes);
  delete nodes[el];
}

function countDescendants(el: string, nodes: Record<string, PdsNode>): number {
  const n = nodes[el];
  if (!n) return 0;
  let count = 0;
  for (const c of n.children ?? []) count += 1 + countDescendants(c, nodes);
  return count;
}

/** Collapses every node whose `pattern` is in `roles`, top-down from root —
 *  an ancestor match wins over a nested one (a collapsed footer's own
 *  "card" child, if any, is simply gone, not separately collapsed). Returns
 *  a new `PdsDocument`; the input is not mutated. */
export function collapseByRole(doc: PdsDocument, roles: Set<string>): PdsDocument {
  if (roles.size === 0) return doc;
  const nodes: Record<string, PdsNode> = { ...doc.nodes };

  function walk(el: string): void {
    const n = nodes[el];
    if (!n) return;
    if (n.pattern && roles.has(n.pattern) && n.children && n.children.length > 0) {
      const hidden = countDescendants(el, nodes);
      const summary = summarize(n, nodes);
      for (const child of n.children) deleteSubtree(child, nodes);
      nodes[el] = { ...n, children: undefined, more: hidden, summary };
      return; // don't recurse into a node we just collapsed
    }
    for (const child of n.children ?? []) walk(child);
  }
  walk(doc.root);

  const estTokens = estimateTokens(JSON.stringify({ tokens: doc.tokens, nodes }));
  return { ...doc, nodes, meta: { ...doc.meta, nodeCount: Object.keys(nodes).length, estTokens } };
}
