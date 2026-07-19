/**
 * Benchmark harness — docs/ROADMAP-v0.14-design-intelligence.md §9.
 *
 * Two ways to run this:
 *   - `bench/floors.test.ts` imports the exported functions directly and
 *     asserts against `bench/floors.json` as part of the normal, fast
 *     `npm run test` — this is the CI gate.
 *   - `npm run bench` runs this file's CLI entry point directly, printing a
 *     human-readable report and writing `bench/report.json` (gitignored —
 *     a generated artifact, not a tracked file).
 *
 * The stress fixture here is intentionally modest (a few thousand nodes),
 * not the 100MB-file scale named in the original brief — this benchmark
 * has to stay fast enough to run on every `npm test`, and a real 100MB
 * stress pass would dominate that budget. If/when a true large-file stress
 * benchmark is needed, it belongs as a separate, explicitly opt-in script,
 * not folded into the CI-gated fast path.
 */
import { buildSemanticGraph } from "../src/semantic/build";
import { RoleEnricher } from "../src/semantic/enrichers/role";
import { runEnrichers } from "../src/semantic/enricher";
import { normalize } from "../src/normalize/normalize";
import type { CirEdge, CirNode, SemanticGraph } from "../src/semantic/graph";
import type { FigmaFileResult, FigmaNode } from "../src/figma/types";
import { ROLE_FIXTURES } from "./fixtures/role.fixtures";
import { aggregatePrecisionRecallF1, precisionRecallF1, tokenDedupRatio } from "./metrics";
import type { PrecisionRecallF1 } from "./metrics";

export interface AccuracyReport {
  perFixture: { name: string; score: PrecisionRecallF1 }[];
  overall: PrecisionRecallF1;
}

export function runRoleAccuracy(): AccuracyReport {
  const perFixture = ROLE_FIXTURES.map((fixture) => {
    const predicted = new Map(
      RoleEnricher.run(fixture.graph)
        .filter((a) => a.namespace === "role")
        .map((a) => [a.nodeId, String(a.value)]),
    );
    return { name: fixture.name, score: precisionRecallF1(predicted, fixture.expected) };
  });
  return { perFixture, overall: aggregatePrecisionRecallF1(perFixture.map((f) => f.score)) };
}

/** N repeat-group sections under one root — exercises RoleEnricher's edge
 *  scan (classifyCardTemplates) at a scale a curated unit-test set can't. */
function buildSyntheticStressGraph(sections: number): SemanticGraph {
  const nodes: Record<string, CirNode> = {};
  const edges: CirEdge[] = [];
  const sectionIds: string[] = [];

  for (let i = 0; i < sections; i++) {
    const labelId = `label-${i}`;
    const templateId = `template-${i}`;
    const listId = `list-${i}`;
    nodes[labelId] = {
      id: labelId,
      kind: "text",
      box: { w: 80, h: 16 },
      children: [],
      chars: `Item ${i}`,
      style: {},
      sourceRef: { adapter: "figma", nativeId: labelId },
    };
    nodes[templateId] = {
      id: templateId,
      kind: "container",
      box: { w: 240, h: 160 },
      children: [labelId],
      style: { isSurface: true },
      sourceRef: { adapter: "figma", nativeId: templateId },
    };
    nodes[listId] = {
      id: listId,
      kind: "container",
      box: { w: 1000, h: 200 },
      children: [templateId],
      style: {},
      sourceRef: { adapter: "figma", nativeId: listId },
    };
    edges.push({ from: listId, to: templateId, kind: "repeats" });
    sectionIds.push(listId);
  }

  nodes.root = {
    id: "root",
    kind: "container",
    box: { w: 1000, h: 200 * sections },
    children: sectionIds,
    style: { layout: { flow: "col", pad: [0, 0, 0, 0] } },
    sourceRef: { adapter: "figma", nativeId: "root" },
  };

  return { cirVersion: "1.0.0", root: "root", nodes, edges };
}

export interface StressReport {
  sections: number;
  nodeCount: number;
  edgeCount: number;
  latencyMs: number;
  heapDeltaBytes: number;
}

export function runStress(sections = 2000): StressReport {
  const graph = buildSyntheticStressGraph(sections);
  if (globalThis.gc) globalThis.gc();
  const heapBefore = process.memoryUsage().heapUsed;
  const start = performance.now();
  runEnrichers(graph, [RoleEnricher]);
  const latencyMs = performance.now() - start;
  const heapDeltaBytes = process.memoryUsage().heapUsed - heapBefore;
  return { sections, nodeCount: Object.keys(graph.nodes).length, edgeCount: graph.edges.length, latencyMs, heapDeltaBytes };
}

/** A real (not hand-set) compression number: builds a Figma-shaped fixture
 *  with 20 structurally-identical repeated rows (the repeat-compression
 *  path) and reads the dedup ratio off the real `normalize()` output. */
function repeatedListFixture(rows: number): FigmaFileResult {
  const children: FigmaNode[] = [];
  for (let i = 0; i < rows; i++) {
    children.push({
      id: `row-${i}`,
      name: `Row ${i}`,
      type: "FRAME",
      absoluteBoundingBox: { x: 0, y: i * 48, width: 400, height: 40 },
      layoutMode: "HORIZONTAL",
      cornerRadius: 8,
      fills: [{ type: "SOLID", color: { r: 1, g: 1, b: 1 }, visible: true }],
      children: [
        {
          id: `row-${i}-text`,
          name: "Label",
          type: "TEXT",
          absoluteBoundingBox: { x: 0, y: 0, width: 200, height: 20 },
          characters: `Row item ${i}`,
          style: { fontSize: 16, fontWeight: 400, fontFamily: "Inter" },
        },
      ],
    });
  }
  const root: FigmaNode = {
    id: "root",
    name: "List",
    type: "FRAME",
    absoluteBoundingBox: { x: 0, y: 0, width: 400, height: rows * 48 },
    layoutMode: "VERTICAL",
    children,
  };
  return { document: root, fileName: "bench-repeated-list", version: "1" };
}

export function runCompressionSample(rows = 20): { rows: number; estTokens: number; dedupRatio: number } {
  const doc = normalize(repeatedListFixture(rows), 5);
  return { rows, estTokens: doc.meta.estTokens, dedupRatio: tokenDedupRatio(doc) };
}

function isMainModule(): boolean {
  return process.argv[1] !== undefined && import.meta.url === `file://${process.argv[1]}`;
}

if (isMainModule()) {
  const accuracy = runRoleAccuracy();
  const stress = runStress();
  const compression = runCompressionSample();

  console.log("\n=== RoleEnricher accuracy (curated fixture set) ===");
  for (const f of accuracy.perFixture) {
    console.log(`  ${f.name}: P=${f.score.precision.toFixed(2)} R=${f.score.recall.toFixed(2)} F1=${f.score.f1.toFixed(2)}`);
  }
  console.log(
    `  OVERALL: P=${accuracy.overall.precision.toFixed(3)} R=${accuracy.overall.recall.toFixed(3)} F1=${accuracy.overall.f1.toFixed(3)}`,
  );

  console.log("\n=== Stress (synthetic repeat-heavy graph) ===");
  console.log(
    `  ${stress.sections} sections, ${stress.nodeCount} nodes, ${stress.edgeCount} edges — ` +
      `${stress.latencyMs.toFixed(1)}ms, heap Δ ${(stress.heapDeltaBytes / 1024 / 1024).toFixed(1)}MB`,
  );

  console.log("\n=== Compression (real normalize() output, 20-row repeated list) ===");
  console.log(`  estTokens=${compression.estTokens}, token dedup ratio=${compression.dedupRatio.toFixed(3)}`);

  const report = { generatedAt: new Date().toISOString(), accuracy, stress, compression };
  const fs = await import("node:fs");
  fs.writeFileSync(new URL("./report.json", import.meta.url), JSON.stringify(report, null, 2));
  console.log("\nWrote bench/report.json");
}
