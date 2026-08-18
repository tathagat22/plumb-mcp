import { describe, expect, it } from "vitest";
import { PRICING_PDS } from "../demo/fixture";
import type { PdsDocument, PdsNode } from "../pds";
import { critiqueDesign, type RubricDimensionId } from "./rubric";

/**
 * The rubric is the deterministic half of `plumb_review`: it answers "is this
 * any good?" without a model in the loop, so its scores have to move for the
 * right reasons. Asserting exact numbers would freeze the tuning, so each spec
 * below either checks the result's shape or takes a well-formed design and
 * breaks exactly one thing, then asserts the matching dimension — and only
 * that dimension's issues — reacts.
 */

const DIMENSIONS: RubricDimensionId[] = [
  "hierarchy",
  "spacing",
  "contrast",
  "alignment",
  "type-scale",
  "polish",
];

const scoreOf = (doc: PdsDocument, id: RubricDimensionId): number =>
  critiqueDesign(doc).dimensions.find((d) => d.id === id)!.score;

/** Deep-clone the demo design so a mutation can't leak between specs. */
function clone(): PdsDocument {
  return JSON.parse(JSON.stringify(PRICING_PDS)) as PdsDocument;
}

/** Apply a mutation to every node matching a predicate. */
function mutate(doc: PdsDocument, fn: (n: PdsNode) => void): PdsDocument {
  for (const el of Object.keys(doc.nodes)) {
    const node = doc.nodes[el];
    if (node) fn(node);
  }
  return doc;
}

describe("the result's shape", () => {
  const result = critiqueDesign(PRICING_PDS);

  it("scores all six dimensions", () => {
    expect(result.dimensions.map((d) => d.id).sort()).toEqual([...DIMENSIONS].sort());
  });

  it("keeps every sub-score inside 0–100", () => {
    for (const d of result.dimensions) {
      expect(d.score, d.id).toBeGreaterThanOrEqual(0);
      expect(d.score, d.id).toBeLessThanOrEqual(100);
    }
    expect(result.overall).toBeGreaterThanOrEqual(0);
    expect(result.overall).toBeLessThanOrEqual(100);
  });

  it("uses weights that sum to one, so `overall` really is out of 100", () => {
    const total = result.dimensions.reduce((s, d) => s + d.weight, 0);
    expect(total).toBeCloseTo(1, 6);
  });

  it("computes overall as the weighted sum of the dimensions", () => {
    const expected = Math.round(
      result.dimensions.reduce((s, d) => s + d.score * d.weight, 0),
    );
    expect(result.overall).toBe(expected);
  });

  it("sorts issues error-first", () => {
    const rank = { error: 0, warn: 1, info: 2 };
    const ranks = result.issues.map((i) => rank[i.severity]);
    expect([...ranks].sort((a, b) => a - b)).toEqual(ranks);
  });

  it("gives every issue a dimension and an actionable fix", () => {
    for (const issue of result.issues) {
      expect(DIMENSIONS).toContain(issue.dimension);
      expect(issue.message.length).toBeGreaterThan(0);
      expect(issue.fix.length).toBeGreaterThan(0);
    }
  });

  it("is deterministic — the same document scores identically twice", () => {
    expect(critiqueDesign(PRICING_PDS)).toEqual(result);
  });

  it("grades the bundled pricing design as a competent one", () => {
    // Not a golden number: a well-formed design on an 8px grid, with a real
    // type scale and AA-clearing text, should not land in failing territory.
    expect(result.overall).toBeGreaterThan(50);
  });

  it("does not mutate the document it grades", () => {
    const before = JSON.stringify(PRICING_PDS);
    critiqueDesign(PRICING_PDS);
    expect(JSON.stringify(PRICING_PDS)).toBe(before);
  });
});

describe("dimensions react to the flaw they grade", () => {
  it("marks hierarchy down when every text is the same size", () => {
    const flat = mutate(clone(), (n) => {
      if (n.type === "text") n.text = "$t5"; // one 15px style everywhere
    });
    expect(scoreOf(flat, "hierarchy")).toBeLessThan(scoreOf(PRICING_PDS, "hierarchy"));
  });

  it("marks contrast down when body text matches its background", () => {
    const invisible = clone();
    // $c0 is the page background; painting text with it makes every string
    // unreadable while leaving the structure untouched.
    mutate(invisible, (n) => {
      if (n.type === "text") n.fill = "$c0";
    });
    expect(scoreOf(invisible, "contrast")).toBeLessThan(scoreOf(PRICING_PDS, "contrast"));
  });

  it("raises contrast issues at error severity when text is unreadable", () => {
    const invisible = mutate(clone(), (n) => {
      if (n.type === "text") n.fill = "$c0";
    });
    const contrastIssues = critiqueDesign(invisible).issues.filter(
      (i) => i.dimension === "contrast",
    );
    expect(contrastIssues.length).toBeGreaterThan(0);
    expect(contrastIssues.some((i) => i.severity === "error")).toBe(true);
  });

  it("marks spacing down when padding and gaps fall off the grid", () => {
    const offGrid = clone();
    for (const el of Object.keys(offGrid.nodes)) {
      const node = offGrid.nodes[el];
      const layout = node?.layout;
      if (!node || !layout || typeof layout === "string") continue;
      layout.pad = [13, 27, 13, 27];
      if (layout.gap !== undefined) layout.gap = 7;
    }
    // The token table also carries shared layouts; move those off-grid too.
    for (const key of Object.keys(offGrid.tokens.layout ?? {})) {
      const l = offGrid.tokens.layout![key]!;
      l.pad = [13, 27, 13, 27];
      if (l.gap !== undefined) l.gap = 7;
    }
    expect(scoreOf(offGrid, "spacing")).toBeLessThan(scoreOf(PRICING_PDS, "spacing"));
  });

  it("marks alignment down when auto-layout is replaced by absolute positions", () => {
    const absolute = clone();
    for (const el of Object.keys(absolute.nodes)) {
      const node = absolute.nodes[el];
      if (!node) continue;
      delete node.layout;
      node.pos = { x: 17, y: 42 };
    }
    delete absolute.tokens.layout;
    expect(scoreOf(absolute, "alignment")).toBeLessThan(scoreOf(PRICING_PDS, "alignment"));
  });

  it("marks the type scale down when every text node invents its own size", () => {
    const sprawl = clone();
    let size = 11;
    for (const el of Object.keys(sprawl.nodes)) {
      const node = sprawl.nodes[el];
      if (node?.type !== "text") continue;
      const token = `$t${size}`;
      sprawl.tokens.text[token] = `400 ${size}px/1.4 Inter`;
      node.text = token;
      size += 1;
    }
    expect(scoreOf(sprawl, "type-scale")).toBeLessThan(scoreOf(PRICING_PDS, "type-scale"));
  });
});

describe("the optional brief", () => {
  it("scores the same document differently against a conflicting type scale", () => {
    const withBrief = critiqueDesign(PRICING_PDS, { typeSizes: [9, 10, 11] });
    const without = critiqueDesign(PRICING_PDS);
    expect(withBrief.dimensions.find((d) => d.id === "type-scale")!.score).toBeLessThanOrEqual(
      without.dimensions.find((d) => d.id === "type-scale")!.score,
    );
  });

  it("accepts a brief that matches the design without penalising it", () => {
    const sizes = Object.values(PRICING_PDS.tokens.text)
      .map((t) => Number(/(\d+(?:\.\d+)?)px/.exec(t)?.[1]))
      .filter((n) => Number.isFinite(n));
    const matched = critiqueDesign(PRICING_PDS, { typeSizes: sizes });
    expect(matched.overall).toBeGreaterThanOrEqual(critiqueDesign(PRICING_PDS).overall - 1);
  });

  it("survives an empty brief", () => {
    expect(() => critiqueDesign(PRICING_PDS, {})).not.toThrow();
  });
});

describe("degenerate documents", () => {
  const bare: PdsDocument = {
    schemaVersion: "1.0.0",
    file: { name: "empty", version: "1" },
    root: "root",
    tokens: { color: {}, text: {}, radius: {}, shadow: {} },
    nodes: { root: { id: "1:1", el: "root", type: "frame", box: { w: 100, h: 100 } } },
    meta: { nodeCount: 1, estTokens: 0, depthUsed: 1 },
    next: "",
  };

  it("grades an all-but-empty document without throwing", () => {
    const result = critiqueDesign(bare);
    expect(result.dimensions).toHaveLength(6);
    expect(Number.isFinite(result.overall)).toBe(true);
  });

  it("grades a document whose root is missing from the node map", () => {
    expect(() => critiqueDesign({ ...bare, nodes: {} })).not.toThrow();
  });
});
