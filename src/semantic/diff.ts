/**
 * Semantic Graph comparator — docs/ROADMAP-v0.14-design-intelligence.md §10
 * M3. Implementation refinement worth stating plainly: the roadmap's §4
 * diagram sketched this as "DiffEnricher," implying it fits the `Enricher`
 * interface (`run(graph): CirAnnotation[]`, src/semantic/enricher.ts). It
 * doesn't — that interface takes one graph and diffing fundamentally needs
 * two. Forcing it into that shape (e.g. bolting a second-graph parameter
 * onto `Enricher`) would have widened an interface every other enricher
 * has to ignore. So this is its own module — a graph *comparator*, not a
 * registered enricher — called directly by the `plumb_diff` projection.
 * `RoleEnricher` still runs first on each side, independently, so the
 * comparator can narrate using role labels; that dependency is explicit in
 * the caller (src/tools/diff.ts), not hidden inside this module.
 *
 * Matching strategy: primarily by node id (Plumb's `el` handles are already
 * designed to be stable across edits). For ids that only exist on one side
 * — candidates for added/removed — a conservative rename fallback pairs
 * them when exactly one candidate on the other side shares the same
 * `(kind, box.w, box.h)` shape key. Ambiguous shape collisions (more than
 * one candidate) are deliberately left as separate added/removed entries
 * rather than guessed — same "abstain over guess" discipline as
 * RoleEnricher. A full structural fingerprint (as `fingerprintSubtree` in
 * `src/normalize/normalize.ts` does for repeat-group detection) would catch
 * more renames but was judged not worth the complexity for a v1 whose most
 * common case — comparing the same file before/after a content edit — needs
 * id matching, not fuzzy matching. Revisit if real usage shows renames are
 * common enough to matter.
 *
 * "Restyled" detection is intentionally coarse in this version — it
 * compares `kind`, `style.layout?.flow`, and `style.isSurface` (the only
 * facets `CirNode.style` carries today, per its own scope note in
 * graph.ts). Full paint/color diffing needs `style` to grow a resolved-fill
 * facet first — deferred until an enricher (this one, or M4's accessibility
 * enricher) actually needs it, not built speculatively ahead of that.
 */
import type { CirNode, SemanticGraph } from "./graph";

export type ChangeFlag = "moved" | "resized" | "restyled";

interface BoxSnapshot {
  box: { w: number; h: number };
  pos?: { x: number; y: number };
}

export interface ChangedNode {
  nodeId: string;
  role?: string;
  changes: ChangeFlag[];
  before: BoxSnapshot;
  after: BoxSnapshot;
  note: string;
}

export interface AddedOrRemovedNode {
  nodeId: string;
  role?: string;
  kind: CirNode["kind"];
  box: { w: number; h: number };
  note: string;
}

export interface RenamedNode {
  beforeId: string;
  afterId: string;
  role?: string;
  changes: ChangeFlag[];
  note: string;
}

export interface SemanticDiff {
  added: AddedOrRemovedNode[];
  removed: AddedOrRemovedNode[];
  renamed: RenamedNode[];
  changed: ChangedNode[];
  unchangedCount: number;
  summary: string;
}

const POSITION_TOLERANCE_PX = 0.5;
const SIZE_TOLERANCE_PX = 0.5;

function describeNode(role: string | undefined, kind: CirNode["kind"]): string {
  return role ?? kind;
}

function detectChanges(beforeNode: CirNode, afterNode: CirNode): ChangeFlag[] {
  const changes: ChangeFlag[] = [];
  const dx = Math.abs((beforeNode.pos?.x ?? 0) - (afterNode.pos?.x ?? 0));
  const dy = Math.abs((beforeNode.pos?.y ?? 0) - (afterNode.pos?.y ?? 0));
  if (dx > POSITION_TOLERANCE_PX || dy > POSITION_TOLERANCE_PX) changes.push("moved");

  const dw = Math.abs(beforeNode.box.w - afterNode.box.w);
  const dh = Math.abs(beforeNode.box.h - afterNode.box.h);
  if (dw > SIZE_TOLERANCE_PX || dh > SIZE_TOLERANCE_PX) changes.push("resized");

  const restyled =
    beforeNode.kind !== afterNode.kind ||
    beforeNode.style.layout?.flow !== afterNode.style.layout?.flow ||
    Boolean(beforeNode.style.isSurface) !== Boolean(afterNode.style.isSurface);
  if (restyled) changes.push("restyled");

  return changes;
}

function noteForChange(role: string | undefined, kind: CirNode["kind"], before: CirNode, after: CirNode, changes: ChangeFlag[]): string {
  const subject = describeNode(role, kind);
  const parts: string[] = [];
  if (changes.includes("moved")) {
    const from = before.pos ?? { x: 0, y: 0 };
    const to = after.pos ?? { x: 0, y: 0 };
    parts.push(`moved from (${from.x}, ${from.y}) to (${to.x}, ${to.y})`);
  }
  if (changes.includes("resized")) {
    parts.push(`resized from ${before.box.w}×${before.box.h} to ${after.box.w}×${after.box.h}`);
  }
  if (changes.includes("restyled")) parts.push("restyled (layout or surface changed)");
  return `the ${subject} ${parts.join(" and ")}`;
}

function shapeKey(n: CirNode): string {
  return `${n.kind}:${n.box.w}x${n.box.h}`;
}

/** Conservative rename pairing: only when exactly one shape-matching
 *  candidate exists on the other side. See file docstring. */
function matchRenames(onlyBefore: string[], onlyAfter: string[], before: SemanticGraph, after: SemanticGraph): { beforeId: string; afterId: string }[] {
  const beforeByShape = new Map<string, string[]>();
  for (const id of onlyBefore) {
    const n = before.nodes[id];
    if (!n) continue;
    const key = shapeKey(n);
    const bucket = beforeByShape.get(key);
    if (bucket) bucket.push(id);
    else beforeByShape.set(key, [id]);
  }

  const claimed = new Set<string>();
  const pairs: { beforeId: string; afterId: string }[] = [];
  for (const afterId of onlyAfter) {
    const n = after.nodes[afterId];
    if (!n) continue;
    const candidates = (beforeByShape.get(shapeKey(n)) ?? []).filter((id) => !claimed.has(id));
    if (candidates.length === 1) {
      const beforeId = candidates[0];
      if (!beforeId) continue;
      claimed.add(beforeId);
      pairs.push({ beforeId, afterId });
    }
  }
  return pairs;
}

export function diffSemanticGraphs(
  before: SemanticGraph,
  after: SemanticGraph,
  roles: { before?: Map<string, string>; after?: Map<string, string> } = {},
): SemanticDiff {
  const beforeIds = new Set(Object.keys(before.nodes));
  const afterIds = new Set(Object.keys(after.nodes));
  const commonIds = [...beforeIds].filter((id) => afterIds.has(id));
  const onlyBefore = [...beforeIds].filter((id) => !afterIds.has(id));
  const onlyAfter = [...afterIds].filter((id) => !beforeIds.has(id));

  const changed: ChangedNode[] = [];
  let unchangedCount = 0;
  for (const id of commonIds) {
    const beforeNode = before.nodes[id];
    const afterNode = after.nodes[id];
    if (!beforeNode || !afterNode) continue;
    const changes = detectChanges(beforeNode, afterNode);
    if (changes.length === 0) {
      unchangedCount++;
      continue;
    }
    const role = roles.after?.get(id) ?? roles.before?.get(id);
    changed.push({
      nodeId: id,
      role,
      changes,
      before: { box: beforeNode.box, pos: beforeNode.pos },
      after: { box: afterNode.box, pos: afterNode.pos },
      note: noteForChange(role, afterNode.kind, beforeNode, afterNode, changes),
    });
  }

  const renamePairs = matchRenames(onlyBefore, onlyAfter, before, after);
  const renamedBeforeIds = new Set(renamePairs.map((p) => p.beforeId));
  const renamedAfterIds = new Set(renamePairs.map((p) => p.afterId));

  const renamed: RenamedNode[] = renamePairs.map(({ beforeId, afterId }) => {
    const beforeNode = before.nodes[beforeId];
    const afterNode = after.nodes[afterId];
    const role = (afterNode ? roles.after?.get(afterId) : undefined) ?? (beforeNode ? roles.before?.get(beforeId) : undefined);
    const changes = beforeNode && afterNode ? detectChanges(beforeNode, afterNode) : [];
    const subject = describeNode(role, afterNode?.kind ?? beforeNode?.kind ?? "container");
    return {
      beforeId,
      afterId,
      role,
      changes,
      note: `the ${subject} was renamed (id "${beforeId}" → "${afterId}")${changes.length ? `, and ${changes.join(", ")}` : ""}`,
    };
  });

  const added: AddedOrRemovedNode[] = onlyAfter
    .filter((id) => !renamedAfterIds.has(id))
    .map((id) => {
      const n = after.nodes[id];
      const role = roles.after?.get(id);
      const subject = describeNode(role, n?.kind ?? "container");
      return { nodeId: id, role, kind: n?.kind ?? "container", box: n?.box ?? { w: 0, h: 0 }, note: `a new ${subject} was added` };
    });

  const removed: AddedOrRemovedNode[] = onlyBefore
    .filter((id) => !renamedBeforeIds.has(id))
    .map((id) => {
      const n = before.nodes[id];
      const role = roles.before?.get(id);
      const subject = describeNode(role, n?.kind ?? "container");
      return { nodeId: id, role, kind: n?.kind ?? "container", box: n?.box ?? { w: 0, h: 0 }, note: `the ${subject} was removed` };
    });

  const summaryParts: string[] = [];
  if (added.length) summaryParts.push(`${added.length} added`);
  if (removed.length) summaryParts.push(`${removed.length} removed`);
  if (renamed.length) summaryParts.push(`${renamed.length} renamed`);
  if (changed.length) summaryParts.push(`${changed.length} changed`);
  const summary = summaryParts.length ? `${summaryParts.join(", ")} (${unchangedCount} unchanged).` : `No structural changes (${unchangedCount} unchanged).`;

  return { added, removed, renamed, changed, unchangedCount, summary };
}
