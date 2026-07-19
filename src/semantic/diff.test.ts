import { describe, expect, it } from "vitest";
import type { CirNode, SemanticGraph } from "./graph";
import { diffSemanticGraphs } from "./diff";

let nextId = 0;

function node(partial: Partial<CirNode> & { kind: CirNode["kind"] }): CirNode {
  const id = partial.id ?? `n${nextId++}`;
  return {
    id,
    box: { w: 100, h: 100 },
    children: [],
    style: {},
    sourceRef: { adapter: "figma", nativeId: id },
    ...partial,
  };
}

function graph(root: CirNode, all: CirNode[]): SemanticGraph {
  const nodes: Record<string, CirNode> = {};
  for (const n of all) nodes[n.id] = n;
  nodes[root.id] = root;
  return { cirVersion: "1.0.0", root: root.id, nodes, edges: [] };
}

describe("diffSemanticGraphs", () => {
  it("reports no changes when both graphs are identical", () => {
    const a = node({ id: "a", kind: "text" });
    const root = node({ id: "root", kind: "container", children: ["a"] });
    const g = graph(root, [a]);

    const diff = diffSemanticGraphs(g, g);

    expect(diff.added).toHaveLength(0);
    expect(diff.removed).toHaveLength(0);
    expect(diff.changed).toHaveLength(0);
    expect(diff.renamed).toHaveLength(0);
    expect(diff.unchangedCount).toBe(2); // root + a
    expect(diff.summary).toContain("No structural changes");
  });

  it("flags a moved node without flagging resize or restyle", () => {
    const beforeNode = node({ id: "a", kind: "container", pos: { x: 0, y: 0 } });
    const beforeRoot = node({ id: "root", kind: "container", children: ["a"] });
    const before = graph(beforeRoot, [beforeNode]);

    const afterNode = node({ id: "a", kind: "container", pos: { x: 0, y: 120 } });
    const afterRoot = node({ id: "root", kind: "container", children: ["a"] });
    const after = graph(afterRoot, [afterNode]);

    const diff = diffSemanticGraphs(before, after);

    expect(diff.changed).toHaveLength(1);
    const delta = diff.changed[0]!;
    expect(delta.nodeId).toBe("a");
    expect(delta.changes).toEqual(["moved"]);
    expect(delta.note).toContain("moved from (0, 0) to (0, 120)");
  });

  it("flags a resized node", () => {
    const before = graph(node({ id: "root", kind: "container", children: ["a"] }), [
      node({ id: "a", kind: "container", box: { w: 100, h: 100 } }),
    ]);
    const after = graph(node({ id: "root", kind: "container", children: ["a"] }), [
      node({ id: "a", kind: "container", box: { w: 200, h: 100 } }),
    ]);

    const diff = diffSemanticGraphs(before, after);

    expect(diff.changed[0]?.changes).toEqual(["resized"]);
  });

  it("flags a restyled node when isSurface flips", () => {
    const before = graph(node({ id: "root", kind: "container", children: ["a"] }), [
      node({ id: "a", kind: "container", style: {} }),
    ]);
    const after = graph(node({ id: "root", kind: "container", children: ["a"] }), [
      node({ id: "a", kind: "container", style: { isSurface: true } }),
    ]);

    const diff = diffSemanticGraphs(before, after);

    expect(diff.changed[0]?.changes).toEqual(["restyled"]);
  });

  it("reports an added node with role narration when a role map is given", () => {
    const before = graph(node({ id: "root", kind: "container" }), []);
    const cardNode = node({ id: "card1", kind: "container", box: { w: 300, h: 200 } });
    const after = graph(node({ id: "root", kind: "container", children: ["card1"] }), [cardNode]);

    const diff = diffSemanticGraphs(before, after, { after: new Map([["card1", "card"]]) });

    expect(diff.added).toHaveLength(1);
    expect(diff.added[0]).toMatchObject({ nodeId: "card1", role: "card", note: "a new card was added" });
  });

  it("reports a removed node", () => {
    const removedNode = node({ id: "old", kind: "text", box: { w: 50, h: 20 } });
    const before = graph(node({ id: "root", kind: "container", children: ["old"] }), [removedNode]);
    const after = graph(node({ id: "root", kind: "container" }), []);

    const diff = diffSemanticGraphs(before, after);

    expect(diff.removed).toHaveLength(1);
    expect(diff.removed[0]?.nodeId).toBe("old");
  });

  it("pairs a rename when exactly one shape-matching candidate exists on the other side", () => {
    const beforeNode = node({ id: "hero", kind: "container", box: { w: 1200, h: 400 } });
    const before = graph(node({ id: "root", kind: "container", children: ["hero"] }), [beforeNode]);
    const afterNode = node({ id: "hero-section", kind: "container", box: { w: 1200, h: 400 } });
    const after = graph(node({ id: "root", kind: "container", children: ["hero-section"] }), [afterNode]);

    const diff = diffSemanticGraphs(before, after);

    expect(diff.added).toHaveLength(0);
    expect(diff.removed).toHaveLength(0);
    expect(diff.renamed).toHaveLength(1);
    expect(diff.renamed[0]).toMatchObject({ beforeId: "hero", afterId: "hero-section" });
  });

  it("does NOT guess a rename when more than one shape-matching candidate exists (ambiguous)", () => {
    const before = graph(node({ id: "root", kind: "container", children: ["a", "b"] }), [
      node({ id: "a", kind: "container", box: { w: 100, h: 100 } }),
      node({ id: "b", kind: "container", box: { w: 100, h: 100 } }),
    ]);
    const after = graph(node({ id: "root", kind: "container", children: ["c"] }), [
      node({ id: "c", kind: "container", box: { w: 100, h: 100 } }),
    ]);

    const diff = diffSemanticGraphs(before, after);

    expect(diff.renamed).toHaveLength(0);
    expect(diff.removed).toHaveLength(2);
    expect(diff.added).toHaveLength(1);
  });

  it("builds a one-line summary covering every bucket", () => {
    // Different shapes on purpose — same-shape old/new would rename-match
    // (see the dedicated rename test above) rather than land as added+removed.
    const before = graph(node({ id: "root", kind: "container", children: ["old"] }), [
      node({ id: "old", kind: "text", box: { w: 50, h: 20 } }),
    ]);
    const after = graph(node({ id: "root", kind: "container", children: ["new"] }), [
      node({ id: "new", kind: "vector", box: { w: 400, h: 400 } }),
    ]);

    const diff = diffSemanticGraphs(before, after);

    expect(diff.summary).toContain("1 added");
    expect(diff.summary).toContain("1 removed");
    expect(diff.summary).toContain("unchanged");
  });
});
