import { describe, expect, it } from "vitest";
import type { PdsDocument, PdsNode, TokenTable } from "../pds";
import { buildSemanticGraph } from "./build";

function doc(nodes: Record<string, PdsNode>, root: string, tokens: Partial<TokenTable> = {}): PdsDocument {
  return {
    schemaVersion: "1.0.0",
    file: { name: "test", version: "1" },
    root,
    tokens: { color: {}, text: {}, radius: {}, shadow: {}, ...tokens },
    nodes,
    meta: { nodeCount: Object.keys(nodes).length, estTokens: 0, depthUsed: 1 },
    next: "",
  };
}

describe("buildSemanticGraph — node kind mapping", () => {
  it("maps text/instance/vector/image/container correctly", () => {
    const nodes: Record<string, PdsNode> = {
      root: { id: "0", el: "root", type: "frame", box: { w: 100, h: 100 }, children: ["t", "i", "v", "img", "r"] },
      t: { id: "1", el: "t", type: "text", box: { w: 10, h: 10 } },
      i: { id: "2", el: "i", type: "instance", box: { w: 10, h: 10 } },
      v: { id: "3", el: "v", type: "vector", box: { w: 10, h: 10 } },
      img: { id: "4", el: "img", type: "rect", box: { w: 10, h: 10 }, assetId: "asset-1" },
      r: { id: "5", el: "r", type: "rect", box: { w: 10, h: 10 } },
    };
    const graph = buildSemanticGraph(doc(nodes, "root"));

    expect(graph.nodes.root?.kind).toBe("container");
    expect(graph.nodes.t?.kind).toBe("text");
    expect(graph.nodes.i?.kind).toBe("componentInstance");
    expect(graph.nodes.v?.kind).toBe("vector");
    expect(graph.nodes.img?.kind).toBe("image"); // assetId wins over "rect" type
    expect(graph.nodes.r?.kind).toBe("container");
  });
});

describe("buildSemanticGraph — edges", () => {
  it("emits a contains edge per child", () => {
    const nodes: Record<string, PdsNode> = {
      root: { id: "0", el: "root", type: "frame", box: { w: 10, h: 10 }, children: ["a", "b"] },
      a: { id: "1", el: "a", type: "rect", box: { w: 1, h: 1 } },
      b: { id: "2", el: "b", type: "rect", box: { w: 1, h: 1 } },
    };
    const graph = buildSemanticGraph(doc(nodes, "root"));
    const contains = graph.edges.filter((e) => e.kind === "contains");

    expect(contains).toContainEqual({ from: "root", to: "a", kind: "contains" });
    expect(contains).toContainEqual({ from: "root", to: "b", kind: "contains" });
  });

  it("emits an instanceOf edge carrying the variant when the component is a structured ref", () => {
    const nodes: Record<string, PdsNode> = {
      root: {
        id: "0",
        el: "root",
        type: "instance",
        box: { w: 10, h: 10 },
        component: { id: "comp-1", variant: "Size=md" },
      },
    };
    const graph = buildSemanticGraph(doc(nodes, "root"));
    const edge = graph.edges.find((e) => e.kind === "instanceOf");

    expect(edge).toEqual({ from: "root", to: "comp-1", kind: "instanceOf", meta: { variant: "Size=md" } });
  });

  it("emits a repeats edge from the parent to the template, for both single and array repeat groups", () => {
    const nodes: Record<string, PdsNode> = {
      single: { id: "0", el: "single", type: "frame", box: { w: 10, h: 10 }, repeat: { template: "tA", data: {} } },
      multi: {
        id: "1",
        el: "multi",
        type: "frame",
        box: { w: 10, h: 10 },
        repeat: [
          { template: "tB", data: {} },
          { template: "tC", data: {} },
        ],
      },
    };
    // buildSemanticGraph walks every entry in doc.nodes regardless of which
    // one is `root`, so a single call covers both the single- and
    // array-shaped repeat group.
    const graph = buildSemanticGraph(doc(nodes, "single"));
    const repeats = graph.edges.filter((e) => e.kind === "repeats");

    expect(repeats).toContainEqual({ from: "single", to: "tA", kind: "repeats" });
    expect(repeats).toContainEqual({ from: "multi", to: "tB", kind: "repeats" });
    expect(repeats).toContainEqual({ from: "multi", to: "tC", kind: "repeats" });
  });
});

describe("buildSemanticGraph — resolved style", () => {
  it("resolves layout through a token ref", () => {
    const nodes: Record<string, PdsNode> = {
      root: { id: "0", el: "root", type: "frame", box: { w: 10, h: 10 }, layout: "$l1" },
    };
    const tokens: Partial<TokenTable> = { layout: { $l1: { flow: "row", pad: [0, 0, 0, 0] } } };
    const graph = buildSemanticGraph(doc(nodes, "root", tokens));

    expect(graph.nodes.root?.style.layout).toEqual({ flow: "row", pad: [0, 0, 0, 0] });
  });

  it("resolves text px through a token ref and from a literal CSS string", () => {
    const nodes: Record<string, PdsNode> = {
      ref: { id: "0", el: "ref", type: "text", box: { w: 10, h: 10 }, text: "$t1" },
      literal: { id: "1", el: "literal", type: "text", box: { w: 10, h: 10 }, text: "700 32px/1.2 Inter" },
    };
    const tokens: Partial<TokenTable> = { text: { $t1: "400 16px/1.4 Inter" } };
    const rootDoc = doc({ ...nodes, root: { id: "2", el: "root", type: "frame", box: { w: 1, h: 1 }, children: ["ref", "literal"] } }, "root", tokens);
    const graph = buildSemanticGraph(rootDoc);

    expect(graph.nodes.ref?.style.textPx).toBe(16);
    expect(graph.nodes.literal?.style.textPx).toBe(32);
  });

  it("flags isSurface for radius, shadow/effects, or fill+stroke, and not for a bare container", () => {
    const nodes: Record<string, PdsNode> = {
      radius: { id: "0", el: "radius", type: "rect", box: { w: 1, h: 1 }, radius: "$r1" },
      shadow: { id: "1", el: "shadow", type: "rect", box: { w: 1, h: 1 }, shadow: "0 1px 2px #000" },
      fillStroke: { id: "2", el: "fillStroke", type: "rect", box: { w: 1, h: 1 }, fill: "$c1", stroke: "$c2" },
      bare: { id: "3", el: "bare", type: "rect", box: { w: 1, h: 1 } },
    };
    const graph = buildSemanticGraph(doc(nodes, "radius"));

    expect(buildSemanticGraph(doc(nodes, "shadow")).nodes.shadow?.style.isSurface).toBe(true);
    expect(buildSemanticGraph(doc(nodes, "fillStroke")).nodes.fillStroke?.style.isSurface).toBe(true);
    expect(graph.nodes.radius?.style.isSurface).toBe(true);
    expect(graph.nodes.bare?.style.isSurface).toBeUndefined();
  });

  it("resolves the actual border radius/color/width values, not just the isSurface boolean", () => {
    const nodes: Record<string, PdsNode> = {
      styled: {
        id: "0",
        el: "styled",
        type: "rect",
        box: { w: 1, h: 1 },
        radius: "$r1",
        stroke: "$c1",
        strokeW: 2,
      },
    };
    const tokens: Partial<TokenTable> = { radius: { $r1: 8 }, color: { $c1: "#e5e5e5" } };
    const graph = buildSemanticGraph(doc(nodes, "styled", tokens));

    expect(graph.nodes.styled?.style.borderRadius).toBe(8);
    expect(graph.nodes.styled?.style.borderColor).toBe("#e5e5e5");
    expect(graph.nodes.styled?.style.borderWidth).toBe(2);
  });

  it("resolves a 'full' (pill/circle) radius through the token table", () => {
    const nodes: Record<string, PdsNode> = {
      pill: { id: "0", el: "pill", type: "rect", box: { w: 1, h: 1 }, radius: "$r1" },
    };
    const tokens: Partial<TokenTable> = { radius: { $r1: "full" } };

    expect(buildSemanticGraph(doc(nodes, "pill", tokens)).nodes.pill?.style.borderRadius).toBe("full");
  });

  it("populates imageSrc with the plumb_assets export convention when assetId is present", () => {
    const nodes: Record<string, PdsNode> = {
      photo: { id: "0", el: "photo", type: "rect", box: { w: 1, h: 1 }, assetId: "abc123" },
      plain: { id: "1", el: "plain", type: "rect", box: { w: 1, h: 1 } },
    };

    expect(buildSemanticGraph(doc(nodes, "photo")).nodes.photo?.imageSrc).toBe("./assets/abc123.png");
    expect(buildSemanticGraph(doc(nodes, "plain")).nodes.plain?.imageSrc).toBeUndefined();
  });

  it("carries textDecoration and textCase through from PdsNode (Phase E parity fix)", () => {
    // Regression: styleOf() used to drop these on the floor for every
    // Figma-sourced node, even though normalize() already resolved them —
    // plumb_emit_react silently produced no underline/case for Figma text.
    const nodes: Record<string, PdsNode> = {
      label: {
        id: "0",
        el: "label",
        type: "text",
        box: { w: 40, h: 10 },
        textDecoration: "underline",
        textCase: "UPPER",
      },
    };

    const style = buildSemanticGraph(doc(nodes, "label")).nodes.label?.style;
    expect(style?.textDecoration).toBe("underline");
    expect(style?.textCase).toBe("UPPER");
  });

  it("carries grow/selfAlign/sizing through for responsive React emit (Phase E)", () => {
    const nodes: Record<string, PdsNode> = {
      flexChild: {
        id: "0",
        el: "flexChild",
        type: "frame",
        box: { w: 100, h: 40 },
        grow: 1,
        selfAlign: "stretch",
        sizing: { w: "fill", h: "hug" },
      },
    };

    const style = buildSemanticGraph(doc(nodes, "flexChild")).nodes.flexChild?.style;
    expect(style?.grow).toBe(1);
    expect(style?.selfAlign).toBe("stretch");
    expect(style?.sizing).toEqual({ w: "fill", h: "hug" });
  });

  it("carries a literal vectorPath through, and resolves a $v token ref (Phase F1)", () => {
    const nodes: Record<string, PdsNode> = {
      literal: { id: "0", el: "literal", type: "vector", box: { w: 24, h: 24 }, vectorPath: "M0 0h24v24H0z" },
      ref: { id: "1", el: "ref", type: "vector", box: { w: 24, h: 24 }, vectorPath: "$v1" },
    };
    const tokens: Partial<TokenTable> = { vector: { $v1: "M2 2h20v20H2z" } };

    const g = buildSemanticGraph(doc(nodes, "literal", tokens));
    expect(g.nodes.literal?.vectorPath).toBe("M0 0h24v24H0z");

    const g2 = buildSemanticGraph(doc(nodes, "ref", tokens));
    expect(g2.nodes.ref?.vectorPath).toBe("M2 2h20v20H2z");
  });
});
