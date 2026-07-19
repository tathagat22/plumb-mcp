import { describe, expect, it } from "vitest";
import type { CirEdge, CirNode, SemanticGraph } from "../graph";
import { RoleEnricher } from "./role";

let nextId = 0;

function node(partial: Partial<CirNode> & { kind: CirNode["kind"] }): CirNode {
  const id = partial.id ?? `n${nextId++}`;
  return {
    id,
    box: { w: 0, h: 0 },
    children: [],
    style: {},
    sourceRef: { adapter: "figma", nativeId: id },
    ...partial,
  };
}

function graph(root: CirNode, all: CirNode[], edges: CirEdge[] = []): SemanticGraph {
  const nodes: Record<string, CirNode> = {};
  for (const n of all) nodes[n.id] = n;
  nodes[root.id] = root;
  return { cirVersion: "1.0.0", root: root.id, nodes, edges };
}

function annotationsFor(g: SemanticGraph): Map<string, string> {
  return new Map(RoleEnricher.run(g).map((a) => [a.nodeId, String(a.value)]));
}

describe("RoleEnricher — sections (nav/hero/footer/sidebar)", () => {
  it("labels a full-width row-flow first child as nav, a tall wide second child as hero, and a short wide last child as footer", () => {
    const logo = node({ id: "logo", kind: "container", box: { w: 40, h: 40 } });
    const links = node({ id: "links", kind: "container", box: { w: 300, h: 20 } });
    const nav = node({
      id: "nav",
      kind: "container",
      box: { w: 1200, h: 64 },
      children: ["logo", "links"],
      style: { layout: { flow: "row", pad: [0, 0, 0, 0] } },
    });

    const h1 = node({ id: "h1", kind: "text", box: { w: 400, h: 60 }, style: { textPx: 48 } });
    const hero = node({ id: "hero", kind: "container", box: { w: 1200, h: 400 }, children: ["h1"] });

    const flink = node({ id: "flink", kind: "text", box: { w: 100, h: 16 } });
    const footer = node({ id: "footer", kind: "container", box: { w: 1200, h: 120 }, children: ["flink"] });

    const root = node({
      id: "root",
      kind: "container",
      box: { w: 1200, h: 2000 },
      children: ["nav", "hero", "footer"],
      style: { layout: { flow: "col", pad: [0, 0, 0, 0] } },
    });

    const labels = annotationsFor(graph(root, [logo, links, nav, h1, hero, flink, footer]));

    expect(labels.get("nav")).toBe("nav");
    expect(labels.get("hero")).toBe("hero");
    expect(labels.get("footer")).toBe("footer");
  });

  it("does not label a nav-shaped section that isn't near full width", () => {
    const a = node({ id: "a", kind: "text", box: { w: 20, h: 20 } });
    const b = node({ id: "b", kind: "text", box: { w: 20, h: 20 } });
    const narrowRow = node({
      id: "narrowRow",
      kind: "container",
      box: { w: 200, h: 60 },
      children: ["a", "b"],
      style: { layout: { flow: "row", pad: [0, 0, 0, 0] } },
    });
    const other = node({ id: "other", kind: "container", box: { w: 1200, h: 300 } });
    const root = node({
      id: "root",
      kind: "container",
      box: { w: 1200, h: 1000 },
      children: ["narrowRow", "other"],
      style: { layout: { flow: "col", pad: [0, 0, 0, 0] } },
    });

    const labels = annotationsFor(graph(root, [a, b, narrowRow, other]));

    expect(labels.get("narrowRow")).toBeUndefined();
  });

  it("does not label a wide-and-tall section as hero when it has no headline-sized text", () => {
    const small = node({ id: "small", kind: "text", box: { w: 100, h: 16 }, style: { textPx: 14 } });
    const section = node({ id: "section", kind: "container", box: { w: 1200, h: 400 }, children: ["small"] });
    const filler = node({ id: "filler", kind: "container", box: { w: 1200, h: 200 } });
    const root = node({
      id: "root",
      kind: "container",
      box: { w: 1200, h: 1000 },
      children: ["section", "filler"],
      style: { layout: { flow: "col", pad: [0, 0, 0, 0] } },
    });

    const labels = annotationsFor(graph(root, [small, section, filler]));

    expect(labels.get("section")).toBeUndefined();
  });

  it("labels a narrow full-height first child of a row-flow root as sidebar", () => {
    const sidebar = node({ id: "sidebar", kind: "container", box: { w: 240, h: 950 } });
    const main = node({ id: "main", kind: "container", box: { w: 960, h: 950 } });
    const root = node({
      id: "root",
      kind: "container",
      box: { w: 1200, h: 1000 },
      children: ["sidebar", "main"],
      style: { layout: { flow: "row", pad: [0, 0, 0, 0] } },
    });

    const labels = annotationsFor(graph(root, [sidebar, main]));

    expect(labels.get("sidebar")).toBe("sidebar");
    expect(labels.get("main")).toBeUndefined();
  });

  it("respects absolute pos (free-canvas root) for nav/hero/footer ordering instead of children array order", () => {
    const flink = node({ id: "flink", kind: "text", box: { w: 80, h: 16 } });
    const footer = node({
      id: "footer",
      kind: "container",
      box: { w: 1200, h: 100 },
      pos: { x: 0, y: 1500 },
      children: ["flink"],
    });

    const h1 = node({ id: "h1", kind: "text", box: { w: 400, h: 60 }, style: { textPx: 40 } });
    const hero = node({
      id: "hero",
      kind: "container",
      box: { w: 1200, h: 500 },
      pos: { x: 0, y: 0 },
      children: ["h1"],
    });

    // Children array is deliberately out of visual order to prove pos wins.
    const root = node({ id: "root", kind: "container", box: { w: 1200, h: 1600 }, children: ["footer", "hero"] });

    const labels = annotationsFor(graph(root, [flink, footer, h1, hero]));

    expect(labels.get("hero")).toBe("hero");
    expect(labels.get("footer")).toBe("footer");
  });
});

describe("RoleEnricher — card (repeats edges)", () => {
  it("labels a repeat-group template as card when it's a styled surface with its own text", () => {
    const label = node({ id: "cardLabel", kind: "text", box: { w: 80, h: 16 }, chars: "Pro plan" });
    const template = node({
      id: "cardTemplate",
      kind: "container",
      box: { w: 300, h: 200 },
      children: ["cardLabel"],
      style: { isSurface: true },
    });
    const list = node({ id: "list", kind: "container", box: { w: 1000, h: 200 }, children: ["cardTemplate"] });
    const root = node({ id: "root", kind: "container", box: { w: 1000, h: 400 }, children: ["list"] });

    const g = graph(root, [label, template, list], [{ from: "list", to: "cardTemplate", kind: "repeats" }]);
    const labels = annotationsFor(g);

    expect(labels.get("cardTemplate")).toBe("card");
  });

  it("does not label a repeated row as card when it has no surface styling", () => {
    const label = node({ id: "rowLabel", kind: "text", box: { w: 80, h: 16 }, chars: "Item" });
    const template = node({
      id: "rowTemplate",
      kind: "container",
      box: { w: 800, h: 40 },
      children: ["rowLabel"],
    });
    const list = node({ id: "list", kind: "container", box: { w: 800, h: 200 }, children: ["rowTemplate"] });
    const root = node({ id: "root", kind: "container", box: { w: 800, h: 400 }, children: ["list"] });

    const g = graph(root, [label, template, list], [{ from: "list", to: "rowTemplate", kind: "repeats" }]);
    const labels = annotationsFor(g);

    expect(labels.get("rowTemplate")).toBeUndefined();
  });

  it("handles multiple repeat edges from the same parent", () => {
    const t1Label = node({ id: "t1Label", kind: "text", box: { w: 60, h: 14 }, chars: "Basic" });
    const t1 = node({
      id: "t1",
      kind: "container",
      box: { w: 240, h: 160 },
      children: ["t1Label"],
      style: { isSurface: true },
    });
    const t2Label = node({ id: "t2Label", kind: "text", box: { w: 60, h: 14 }, chars: "Row" });
    const t2 = node({ id: "t2", kind: "container", box: { w: 240, h: 40 }, children: ["t2Label"] });
    const parent = node({ id: "parent", kind: "container", box: { w: 1000, h: 400 }, children: ["t1", "t2"] });
    const root = node({ id: "root", kind: "container", box: { w: 1000, h: 400 }, children: ["parent"] });

    const g = graph(
      root,
      [t1Label, t1, t2Label, t2, parent],
      [
        { from: "parent", to: "t1", kind: "repeats" },
        { from: "parent", to: "t2", kind: "repeats" },
      ],
    );
    const labels = annotationsFor(g);

    expect(labels.get("t1")).toBe("card");
    expect(labels.get("t2")).toBeUndefined();
  });
});
