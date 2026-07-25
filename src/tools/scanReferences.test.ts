import { describe, expect, it } from "vitest";
import { exemplarFor, textSizesUnder } from "./scanReferences";
import type { WebNode } from "../semantic/project/web";

function node(partial: Partial<WebNode> & { id: string; kind: WebNode["kind"] }): WebNode {
  return { box: { w: 0, h: 0 }, children: [], ...partial };
}

describe("textSizesUnder — Phase D2", () => {
  it("collects distinct text sizes from the node itself and its descendants, largest first", () => {
    const headline = node({ id: "headline", kind: "text", textPx: 48 });
    const sub = node({ id: "sub", kind: "text", textPx: 18 });
    const hero = node({ id: "hero", kind: "container", children: ["headline", "sub"] });
    const nodes = { hero, headline, sub };

    expect(textSizesUnder("hero", nodes, 3)).toEqual([48, 18]);
  });

  it("dedupes repeated sizes", () => {
    const a = node({ id: "a", kind: "text", textPx: 16 });
    const b = node({ id: "b", kind: "text", textPx: 16 });
    const root = node({ id: "root", kind: "container", children: ["a", "b"] });
    const nodes = { root, a, b };

    expect(textSizesUnder("root", nodes, 3)).toEqual([16]);
  });

  it("stops at the given depth", () => {
    const deep = node({ id: "deep", kind: "text", textPx: 12 });
    const mid = node({ id: "mid", kind: "container", children: ["deep"] });
    const root = node({ id: "root", kind: "container", children: ["mid"] });
    const nodes = { root, mid, deep };

    expect(textSizesUnder("root", nodes, 1)).toEqual([]);
    expect(textSizesUnder("root", nodes, 2)).toEqual([12]);
  });

  it("returns an empty array for a missing node id instead of throwing", () => {
    expect(textSizesUnder("missing", {}, 3)).toEqual([]);
  });
});

describe("exemplarFor — Phase D2", () => {
  it("builds a compact exemplar from a WebNode's own facets plus descendant text sizes", () => {
    const headline = node({ id: "headline", kind: "text", textPx: 56 });
    const hero = node({
      id: "hero",
      kind: "container",
      box: { w: 1200, h: 560 },
      layout: { flow: "col", pad: [0, 0, 0, 0] },
      fillColor: "#0a0a0a",
      textAlign: "center",
      fontFamily: "Inter",
      children: ["headline"],
    });
    const nodes = { hero, headline };

    expect(exemplarFor("https://example.com", hero, nodes)).toEqual({
      url: "https://example.com",
      box: { w: 1200, h: 560 },
      layout: { flow: "col", pad: [0, 0, 0, 0] },
      fillColor: "#0a0a0a",
      textSizes: [56],
      textAlign: "center",
      fontFamily: "Inter",
    });
  });
});
