import { describe, expect, it } from "vitest";
import type { PdsDocument, PdsNode } from "../pds";
import { computeCoverage, isImportantNode } from "./coverage";

/**
 * Coverage exists because a delta-only report can be gamed by not building
 * anything: zero elements tagged means zero comparisons made means zero
 * deltas. The `important` split is what stops the opposite failure — an agent
 * being punished for not tagging spacer frames that carry no visual signal.
 */

const node = (el: string, over: Partial<PdsNode> = {}): PdsNode => ({
  id: `1:${el}`,
  el,
  type: "frame",
  box: { w: 100, h: 40 },
  ...over,
});

/** Build a PDS from a flat list; the first node is the root. */
function doc(nodes: PdsNode[]): PdsDocument {
  const map: Record<string, PdsNode> = {};
  for (const n of nodes) map[n.el] = n;
  return {
    schemaVersion: "1.0.0",
    file: { name: "test", version: "1" },
    root: nodes[0]!.el,
    tokens: { color: {}, text: {}, radius: {}, shadow: {} },
    nodes: map,
    meta: { nodeCount: nodes.length, estTokens: 0, depthUsed: 1 },
    next: "",
  };
}

describe("isImportantNode", () => {
  it.each([
    ["text style", { text: "$t0" }],
    ["text content", { chars: "Hello" }],
    ["a fill", { fill: "$c0" }],
    ["a fill stack", { fills: [{ type: "color" as const, color: "#fff" }] }],
    ["a shadow", { shadow: "$s0" }],
    ["a backdrop filter", { backdropFilter: "blur(12px)" }],
    ["an exported asset", { assetId: "9:9" }],
    ["a corner radius", { radius: "$r0" }],
    ["an icon hint", { iconHint: "lock" }],
  ])("counts a node with %s", (_label, over) => {
    expect(isImportantNode(node("n", over))).toBe(true);
  });

  it("does not count a bare skeleton frame", () => {
    expect(isImportantNode(node("wrapper"))).toBe(false);
  });

  it("counts radius 0 — an explicitly square corner is still a decision", () => {
    expect(isImportantNode(node("n", { radius: [0, 0, 0, 0] }))).toBe(true);
  });
});

describe("computeCoverage", () => {
  const tree = doc([
    node("root", { children: ["title", "spacer", "card"] }),
    node("title", { type: "text", chars: "Hi", text: "$t0" }),
    node("spacer"),
    node("card", { fill: "$c0", children: ["label"] }),
    node("label", { type: "text", chars: "Buy", text: "$t1" }),
  ]);

  it("reports full coverage when everything was tagged", () => {
    const cov = computeCoverage(tree, new Set(["root", "title", "spacer", "card", "label"]));
    expect(cov).toMatchObject({ pdsTotal: 5, matched: 5, coverage: 1, untagged: [] });
    expect(cov.importantMatched).toBe(cov.importantTotal);
  });

  it("counts only visually meaningful nodes in the important totals", () => {
    // root and spacer carry no fill, text, or effect.
    const cov = computeCoverage(tree, new Set());
    expect(cov.importantTotal).toBe(3);
    expect(cov.importantMatched).toBe(0);
  });

  it("lists untagged nodes, important ones first", () => {
    const cov = computeCoverage(tree, new Set(["root", "title"]));
    // `card` and `label` carry visual signal; `spacer` does not, so it sorts last.
    expect(cov.untagged.indexOf("spacer")).toBe(cov.untagged.length - 1);
    expect(cov.untagged).toContain("card");
    expect(cov.untagged).toContain("label");
  });

  it("ignores orphans that aren't reachable from the requested root", () => {
    // The flat node map can hold nodes outside the requested subtree; counting
    // them would make every partial extraction look under-built.
    const withOrphan = doc([
      node("root", { children: ["title"] }),
      node("title", { type: "text", chars: "Hi", text: "$t0" }),
      node("elsewhere", { fill: "$c9" }),
    ]);
    const cov = computeCoverage(withOrphan, new Set(["root", "title"]));
    expect(cov.pdsTotal).toBe(2);
    expect(cov.untagged).toEqual([]);
  });

  it("survives a child reference that points at a missing node", () => {
    const broken = doc([node("root", { children: ["ghost"] })]);
    expect(() => computeCoverage(broken, new Set(["root"]))).not.toThrow();
  });

  it("survives a cycle in the children graph", () => {
    const cyclic = doc([
      node("root", { children: ["a"] }),
      node("a", { children: ["root"] }),
    ]);
    const cov = computeCoverage(cyclic, new Set(["root"]));
    expect(cov.pdsTotal).toBe(2);
  });

  it("caps the surfaced untagged list so a huge miss stays readable", () => {
    const many = [node("root", { children: [] as string[] })];
    for (let i = 0; i < 50; i += 1) {
      many[0]!.children!.push(`n${i}`);
      many.push(node(`n${i}`, { fill: "$c0" }));
    }
    const cov = computeCoverage(doc(many), new Set(["root"]));
    expect(cov.untagged).toHaveLength(20);
    expect(cov.pdsTotal).toBe(51);
  });

  it("degrades cleanly when the requested root isn't in the node map", () => {
    // The root itself still counts as one reachable handle, so this reports
    // "you built none of the one thing you asked about" rather than throwing
    // or dividing by zero.
    const empty: PdsDocument = { ...doc([node("root")]), root: "missing", nodes: {} };
    const cov = computeCoverage(empty, new Set());
    expect(cov).toMatchObject({ pdsTotal: 1, matched: 0, coverage: 0, importantTotal: 0 });
  });
});
