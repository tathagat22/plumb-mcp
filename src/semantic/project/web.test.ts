import { describe, expect, it } from "vitest";
import { graphFromWebSpec, projectWebSpec } from "./web";
import type { CirAnnotation, CirNode, SemanticGraph } from "../graph";

function node(partial: Partial<CirNode> & { kind: CirNode["kind"] }): CirNode {
  const id = partial.id ?? "n";
  return {
    id,
    box: { w: 100, h: 100 },
    children: [],
    style: {},
    sourceRef: { adapter: "html", nativeId: id },
    ...partial,
  };
}

describe("projectWebSpec — had zero test coverage until this pass", () => {
  it("carries role from the annotation list onto the matching node, and leaves others undefined", () => {
    const heroNode = node({ id: "hero", kind: "container" });
    const otherNode = node({ id: "other", kind: "container" });
    const graph: SemanticGraph = {
      cirVersion: "1.0.0",
      root: "hero",
      nodes: { hero: heroNode, other: otherNode },
      edges: [],
    };
    const annotations: CirAnnotation[] = [{ nodeId: "hero", namespace: "role", version: "1.0.0", value: "hero" }];

    const doc = projectWebSpec("https://example.com", graph, annotations);

    expect(doc.nodes.hero?.role).toBe("hero");
    expect(doc.nodes.other?.role).toBeUndefined();
  });

  it("surfaces every style facet, including the ones added for M10 (imageSrc, borderRadius/Color/Width)", () => {
    const img = node({
      id: "img",
      kind: "image",
      imageSrc: "https://example.com/photo.jpg",
      style: { borderRadius: "full", borderColor: "#e5e5e5", borderWidth: 1 },
    });
    const graph: SemanticGraph = { cirVersion: "1.0.0", root: "img", nodes: { img }, edges: [] };

    const doc = projectWebSpec("https://example.com", graph, []);

    expect(doc.nodes.img).toMatchObject({
      imageSrc: "https://example.com/photo.jpg",
      borderRadius: "full",
      borderColor: "#e5e5e5",
      borderWidth: 1,
    });
  });

  it("omits `children` for a leaf node rather than emitting an empty array", () => {
    const leaf = node({ id: "leaf", kind: "text", chars: "hi" });
    const graph: SemanticGraph = { cirVersion: "1.0.0", root: "leaf", nodes: { leaf }, edges: [] };

    expect(projectWebSpec("https://example.com", graph, []).nodes.leaf?.children).toBeUndefined();
  });
});

describe("graphFromWebSpec — round-trips a projected doc back into a usable SemanticGraph", () => {
  it("preserves kind/box/chars/role/imageSrc/style facts through a full project → un-project round trip", () => {
    const img = node({
      id: "img",
      kind: "image",
      box: { w: 300, h: 200 },
      imageSrc: "https://example.com/photo.jpg",
      style: { fillColor: "#000000", borderRadius: 8, opacity: 0.5 },
    });
    const root = node({ id: "root", kind: "container", children: ["img"] });
    const graph: SemanticGraph = { cirVersion: "1.0.0", root: "root", nodes: { root, img }, edges: [] };
    const annotations: CirAnnotation[] = [{ nodeId: "root", namespace: "role", version: "1.0.0", value: "hero" }];

    const projected = projectWebSpec("https://example.com", graph, annotations);
    const { graph: rebuilt, roleByNode } = graphFromWebSpec(projected);

    expect(rebuilt.nodes.img).toMatchObject({
      kind: "image",
      box: { w: 300, h: 200 },
      imageSrc: "https://example.com/photo.jpg",
    });
    expect(rebuilt.nodes.img?.style).toMatchObject({ fillColor: "#000000", borderRadius: 8, opacity: 0.5 });
    expect(rebuilt.nodes.root?.children).toEqual(["img"]);
    expect(roleByNode.get("root")).toBe("hero");
  });

  it("rebuilds with no edges — an honest empty array, not fabricated ones", () => {
    const root = node({ id: "root", kind: "container" });
    const graph: SemanticGraph = { cirVersion: "1.0.0", root: "root", nodes: { root }, edges: [] };

    const { graph: rebuilt } = graphFromWebSpec(projectWebSpec("https://example.com", graph, []));

    expect(rebuilt.edges).toEqual([]);
  });

  it("carries svgMarkup and textCase through the projection (Phase F1 fix) — textCase was silently dropped before", () => {
    const icon = node({
      id: "icon",
      kind: "vector",
      svgMarkup: '<svg viewBox="0 0 24 24"><path d="M0 0h24v24H0z"/></svg>',
    });
    const label = node({ id: "label", kind: "text", chars: "SHOP NOW", style: { textCase: "UPPER" } });
    const root = node({ id: "root", kind: "container", children: ["icon", "label"] });
    const graph: SemanticGraph = { cirVersion: "1.0.0", root: "root", nodes: { root, icon, label }, edges: [] };

    const projected = projectWebSpec("https://example.com", graph, []);
    expect(projected.nodes.icon?.svgMarkup).toContain("<svg");
    expect(projected.nodes.label?.textCase).toBe("UPPER");

    const { graph: rebuilt } = graphFromWebSpec(projected);
    expect(rebuilt.nodes.icon?.svgMarkup).toContain("<svg");
    expect(rebuilt.nodes.label?.style.textCase).toBe("UPPER");
  });

  it("carries fontFamily through the projection in both directions (Phase F3)", () => {
    const label = node({ id: "label", kind: "text", chars: "Ship faster", style: { fontFamily: "Inter" } });
    const graph: SemanticGraph = { cirVersion: "1.0.0", root: "label", nodes: { label }, edges: [] };

    const projected = projectWebSpec("https://example.com", graph, []);
    expect(projected.nodes.label?.fontFamily).toBe("Inter");

    const { graph: rebuilt } = graphFromWebSpec(projected);
    expect(rebuilt.nodes.label?.style.fontFamily).toBe("Inter");
  });
});
