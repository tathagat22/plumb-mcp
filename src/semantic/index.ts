/**
 * Orchestration barrel for the semantic layer: Source Graph (PdsDocument,
 * already built by normalize()) → Semantic Graph → enrichers → projection
 * back onto the PDS wire shape. `normalize()` calls `applySemanticEnrichers`
 * once, at the very end, after the document is otherwise complete — see
 * docs/ROADMAP-v0.14-design-intelligence.md §10 M2 for why this replaced
 * the inline mid-walk call the first classifier used.
 */
import { buildSemanticGraph } from "./build";
import { RoleEnricher } from "./enrichers/role";
import { runEnrichers } from "./enricher";
import { projectRoleOntoPds } from "./project/pds";
import type { PdsDocument } from "../pds";

const ENRICHERS = [RoleEnricher];

/** Mutates `doc.nodes[*].pattern` in place — same contract the pre-refactor
 *  `classifySemantics` had, so `normalize()`'s call site doesn't change. */
export function applySemanticEnrichers(doc: PdsDocument): void {
  const graph = buildSemanticGraph(doc);
  const annotations = runEnrichers(graph, ENRICHERS);
  projectRoleOntoPds(doc, annotations);
}

export type { CirAnnotation, CirEdge, CirEdgeKind, CirNode, CirNodeStyle, NodeKind, SemanticGraph } from "./graph";
export { buildSemanticGraph } from "./build";
export type { Enricher } from "./enricher";
export { runEnrichers } from "./enricher";
