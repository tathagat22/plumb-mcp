import { describe, expect, it } from "vitest";
import { PRICING_PDS } from "./demo/fixture";
import { describePds } from "./describe";
import type { PdsDocument, PdsNode } from "./pds";

/**
 * `plumb_describe` exists for callers that cannot look at a screenshot — an
 * image-blind harness, a policy that blocks reading images, or an agent
 * counting tokens. That makes it the only view of the design some callers ever
 * get, so the guarantees worth pinning are that it never throws on a malformed
 * document and never silently omits a child.
 */

const node = (el: string, over: Partial<PdsNode> = {}): PdsNode => ({
  id: `1:${el}`,
  el,
  type: "frame",
  box: { w: 100, h: 100 },
  ...over,
});

function doc(nodes: PdsNode[], tokens?: Partial<PdsDocument["tokens"]>): PdsDocument {
  const map: Record<string, PdsNode> = {};
  for (const n of nodes) map[n.el] = n;
  return {
    schemaVersion: "1.0.0",
    file: { name: "test", version: "1" },
    root: nodes[0]!.el,
    tokens: { color: {}, text: {}, radius: {}, shadow: {}, ...tokens },
    nodes: map,
    meta: { nodeCount: nodes.length, estTokens: 0, depthUsed: 1 },
    next: "",
  };
}

describe("describing a real design", () => {
  const result = describePds(PRICING_PDS);

  it("reports the root and its box", () => {
    expect(result.root).toBe("pricing");
    expect(result.box).toEqual({ w: 1152, h: 720 });
  });

  it("recognises an auto-layout root", () => {
    expect(result.layout).toBe("auto");
  });

  it("summarises every direct child, and only the direct children", () => {
    expect(result.children.map((c) => c.el)).toEqual(["header", "plans", "footnote"]);
  });

  it("gives every child a non-empty appearance string", () => {
    for (const child of result.children) {
      expect(child.appearance.length, child.el).toBeGreaterThan(0);
    }
  });

  it("writes a narrative", () => {
    expect(result.narrative.length).toBeGreaterThan(0);
  });

  it("omits the region grid for an auto-layout root, where order is implicit", () => {
    expect(result.regions).toBeUndefined();
    for (const child of result.children) expect(child.region).toBeUndefined();
  });

  it("is deterministic", () => {
    expect(describePds(PRICING_PDS)).toEqual(result);
  });
});

describe("free-positioned roots", () => {
  const free = doc([
    node("root", { children: ["tl", "mid", "br"], box: { w: 900, h: 600 } }),
    node("tl", { pos: { x: 10, y: 10 }, box: { w: 100, h: 50 } }),
    node("mid", { pos: { x: 400, y: 275 }, box: { w: 100, h: 50 } }),
    node("br", { pos: { x: 780, y: 530 }, box: { w: 100, h: 50 } }),
  ]);

  it("reports free layout when the root has no auto-layout", () => {
    expect(describePds(free).layout).toBe("free");
  });

  it("places each child in the 3x3 region grid by its centre", () => {
    const byEl = Object.fromEntries(describePds(free).children.map((c) => [c.el, c.region]));
    expect(byEl.tl).toBe("top-left");
    expect(byEl.mid).toBe("center");
    expect(byEl.br).toBe("bottom-right");
  });

  it("groups the children into a region index", () => {
    const regions = describePds(free).regions;
    expect(regions).toBeDefined();
    expect(regions!["top-left"]).toContain("tl");
    expect(regions!["bottom-right"]).toContain("br");
  });

  it("leaves a child with no position out of the region grid", () => {
    const partial = doc([
      node("root", { children: ["floating"], box: { w: 900, h: 600 } }),
      node("floating"),
    ]);
    expect(describePds(partial).children[0]!.region).toBeUndefined();
  });
});

describe("text handling", () => {
  it("carries a plain string through", () => {
    const d = doc([
      node("root", { children: ["label"] }),
      node("label", { type: "text", chars: "Start free" }),
    ]);
    expect(describePds(d).children[0]!.chars).toBe("Start free");
  });

  it("flattens mixed-style runs into one string", () => {
    // The structured runs stay on the PDS; describe is prose, so the
    // concatenation is the right level of detail here.
    const d = doc([
      node("root", { children: ["rich"] }),
      node("rich", { type: "text", chars: [{ t: "Ship " }, { t: "faster", s: "$t1" }] }),
    ]);
    expect(describePds(d).children[0]!.chars).toBe("Ship faster");
  });

  it("omits chars entirely for a node with no text", () => {
    const d = doc([node("root", { children: ["box"] }), node("box")]);
    expect(describePds(d).children[0]).not.toHaveProperty("chars");
  });
});

describe("degenerate documents", () => {
  it("reports a missing root instead of throwing", () => {
    const orphaned: PdsDocument = { ...doc([node("root")]), root: "gone" };
    const result = describePds(orphaned);
    expect(result.root).toBe("gone");
    expect(result.children).toEqual([]);
    expect(result.narrative).toContain("missing");
  });

  it("skips a child reference that points at nothing", () => {
    const broken = doc([node("root", { children: ["real", "ghost"] }), node("real")]);
    expect(describePds(broken).children.map((c) => c.el)).toEqual(["real"]);
  });

  it("handles a root with no children at all", () => {
    const lonely = doc([node("root")]);
    expect(describePds(lonely).children).toEqual([]);
    expect(describePds(lonely).narrative.length).toBeGreaterThan(0);
  });
});
