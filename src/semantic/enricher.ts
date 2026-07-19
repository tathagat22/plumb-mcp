/**
 * The enricher registry. Fixes a real debt item from the first semantic
 * classifier (docs/ROADMAP-v0.14-design-intelligence.md §11 item 2): running
 * classification at one hardcoded call site inside `normalize()` meant
 * ordering between multiple enrichers was invisible and unenforced. Here,
 * ordering is an explicit, declared dependency (`requires`) resolved by
 * topological sort — a second enricher that needs a first one's output
 * (e.g. a future diff enricher needing `role` on both graphs it compares)
 * is a one-line declaration, not a rewrite of call order somewhere else.
 */
import type { CirAnnotation, SemanticGraph } from "./graph";

export interface Enricher {
  /** Annotation namespace this enricher produces — must be unique. */
  namespace: string;
  version: string;
  /** Heuristic enrichers are free, deterministic, and benchmark-gated in
   *  CI. LLM-assisted enrichers are an opt-in, caller-funded escape hatch,
   *  benchmarked separately and non-blockingly because their output isn't
   *  deterministic. Nothing in this module treats the two differently yet
   *  — the tag exists so a future runner/projection can, without an
   *  Enricher shape change. */
  kind: "heuristic" | "llm-assisted";
  /** Namespaces of other enrichers that must run first. */
  requires?: string[];
  /** Every annotation produced so far this run, in dependency order — an
   *  enricher that declares `requires: ["role"]` reads its input by
   *  filtering this list for `namespace === "role"`, not by re-deriving
   *  it. Optional so enrichers with no `requires` (and direct callers in
   *  tests/tools that only care about one enricher) aren't forced to pass
   *  an empty array. (This parameter didn't exist in the first cut of this
   *  interface — `requires` ordered enrichers correctly but never actually
   *  handed a dependency's output to the enricher that declared it, a gap
   *  only surfaced once a second enricher genuinely needed one. See
   *  docs/ROADMAP-v0.14-design-intelligence.md §10 M4.) */
  run(graph: SemanticGraph, priorAnnotations?: CirAnnotation[]): CirAnnotation[];
}

/** Kahn's-algorithm topological sort over `requires`. Throws on a cycle or
 *  a dependency that isn't in the given enricher set — both are programmer
 *  errors, not runtime conditions to degrade gracefully from. */
function orderEnrichers(enrichers: Enricher[]): Enricher[] {
  const byNamespace = new Map(enrichers.map((e) => [e.namespace, e]));
  const remaining = new Map(enrichers.map((e) => [e.namespace, new Set(e.requires ?? [])]));
  const ordered: Enricher[] = [];

  while (remaining.size > 0) {
    const ready = [...remaining.entries()].filter(([, deps]) => deps.size === 0).map(([ns]) => ns);
    if (ready.length === 0) {
      throw new Error(
        `Enricher dependency cycle or missing requirement among: ${[...remaining.keys()].join(", ")}`,
      );
    }
    for (const ns of ready) {
      const enricher = byNamespace.get(ns);
      if (!enricher) throw new Error(`Enricher "${ns}" required but not registered`);
      ordered.push(enricher);
      remaining.delete(ns);
    }
    for (const deps of remaining.values()) {
      for (const ns of ready) deps.delete(ns);
    }
  }
  return ordered;
}

/** Run every enricher in dependency order, returning the combined annotation
 *  list. A single enricher throwing skips only its own output — never fails
 *  the whole graph (docs/ROADMAP-v0.14-design-intelligence.md §4 failure-mode
 *  contract for the Semantic Graph layer). */
export function runEnrichers(graph: SemanticGraph, enrichers: Enricher[]): CirAnnotation[] {
  const out: CirAnnotation[] = [];
  for (const enricher of orderEnrichers(enrichers)) {
    try {
      out.push(...enricher.run(graph, out.slice()));
    } catch {
      // Swallow — a broken enricher must not take down the whole response.
      // (No logging channel here; stdout is the JSON-RPC channel and stderr
      // logging policy belongs to the caller, not this pure module.)
    }
  }
  return out;
}
