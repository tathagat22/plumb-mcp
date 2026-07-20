import { describe, expect, it } from "vitest";
import { buildSemanticGraphFromHtml } from "./buildFromHtml";
import { RoleEnricher } from "./enrichers/role";
import type { HtmlSourceNode } from "../sources/html/sourceGraph";

let nextId = 0;

function html(partial: Partial<HtmlSourceNode> & { tag: string }): HtmlSourceNode {
  const id = partial.id ?? `n${nextId++}`;
  return {
    id,
    box: { w: 0, h: 0 },
    pos: { x: 0, y: 0 },
    style: {},
    isImage: false,
    children: [],
    ...partial,
  };
}

describe("buildSemanticGraphFromHtml — node kind mapping", () => {
  it("maps image/vector/text/container correctly", () => {
    const img = html({ id: "img", tag: "img", isImage: true });
    const svg = html({ id: "svg", tag: "svg" });
    const text = html({ id: "text", tag: "span", text: "Hello" });
    const div = html({ id: "div", tag: "div", children: [img, svg, text] });

    const graph = buildSemanticGraphFromHtml(div);

    expect(graph.nodes.img?.kind).toBe("image");
    expect(graph.nodes.svg?.kind).toBe("vector");
    expect(graph.nodes.text?.kind).toBe("text");
    expect(graph.nodes.div?.kind).toBe("container");
  });

  it("prefers container over text when the node has element children even if it also has direct text", () => {
    // captureFn.ts only sets `text` on leaf (childless) nodes, so this
    // models what the mapper does if that invariant is ever violated —
    // container wins, matching kindOf's own children.length check.
    const child = html({ id: "child", tag: "span", text: "kid" });
    const parent = html({ id: "parent", tag: "div", text: "should be ignored", children: [child] });

    expect(buildSemanticGraphFromHtml(parent).nodes.parent?.kind).toBe("container");
  });
});

describe("buildSemanticGraphFromHtml — layout", () => {
  it("maps display:flex to a PdsLayout with no enum translation needed", () => {
    const node = html({
      tag: "div",
      style: {
        display: "flex",
        flexDirection: "row",
        gap: "16px",
        justifyContent: "space-between",
        alignItems: "center",
        paddingTop: "8px",
        paddingRight: "12px",
        paddingBottom: "8px",
        paddingLeft: "12px",
      },
    });

    const graph = buildSemanticGraphFromHtml(node);

    expect(graph.nodes[node.id]?.style.layout).toEqual({
      flow: "row",
      pad: [8, 12, 8, 12],
      gap: 16,
      justify: "space-between",
      align: "center",
    });
  });

  it("maps flex-direction:column to flow:'col'", () => {
    const node = html({ tag: "div", style: { display: "flex", flexDirection: "column" } });

    expect(buildSemanticGraphFromHtml(node).nodes[node.id]?.style.layout?.flow).toBe("col");
  });

  it("drops default justify/align values, matching the Figma adapter's own 'drop MIN' convention", () => {
    const node = html({ tag: "div", style: { display: "flex", justifyContent: "flex-start", alignItems: "stretch" } });

    const layout = buildSemanticGraphFromHtml(node).nodes[node.id]?.style.layout;
    expect(layout?.justify).toBeUndefined();
    expect(layout?.align).toBeUndefined();
  });

  it("does not set a layout for non-flex display", () => {
    const node = html({ tag: "div", style: { display: "block" } });

    expect(buildSemanticGraphFromHtml(node).nodes[node.id]?.style.layout).toBeUndefined();
  });
});

describe("buildSemanticGraphFromHtml — color and surface", () => {
  it("resolves rgb() background/text color to hex", () => {
    const container = html({ tag: "div", style: { backgroundColor: "rgb(12, 140, 233)" } });
    const text = html({ tag: "span", text: "hi", style: { color: "rgb(255, 0, 0)" } });

    expect(buildSemanticGraphFromHtml(container).nodes[container.id]?.style.fillColor).toBe("#0c8ce9");
    expect(buildSemanticGraphFromHtml(text).nodes[text.id]?.style.fillColor).toBe("#ff0000");
  });

  it("does not set fillColor for a fully transparent background", () => {
    const node = html({ tag: "div", style: { backgroundColor: "rgba(0, 0, 0, 0)" } });

    expect(buildSemanticGraphFromHtml(node).nodes[node.id]?.style.fillColor).toBeUndefined();
  });

  it("flags isSurface for radius, shadow, or a bordered fill — not for a bare div", () => {
    const radius = html({ id: "radius", tag: "div", style: { borderRadius: "8px" } });
    const shadow = html({ id: "shadow", tag: "div", style: { boxShadow: "0px 1px 2px rgba(0,0,0,0.1)" } });
    const bordered = html({
      id: "bordered",
      tag: "div",
      style: { backgroundColor: "rgb(255,255,255)", borderWidth: "1px" },
    });
    const bare = html({ id: "bare", tag: "div" });

    expect(buildSemanticGraphFromHtml(radius).nodes.radius?.style.isSurface).toBe(true);
    expect(buildSemanticGraphFromHtml(shadow).nodes.shadow?.style.isSurface).toBe(true);
    expect(buildSemanticGraphFromHtml(bordered).nodes.bordered?.style.isSurface).toBe(true);
    expect(buildSemanticGraphFromHtml(bare).nodes.bare?.style.isSurface).toBeUndefined();
  });
});

describe("buildSemanticGraphFromHtml — geometry and edges", () => {
  it("converts viewport-absolute pos to parent-relative", () => {
    const child = html({ id: "child", tag: "div", pos: { x: 120, y: 220 } });
    const root = html({ id: "root", tag: "div", pos: { x: 100, y: 200 }, children: [child] });

    const graph = buildSemanticGraphFromHtml(root);

    expect(graph.nodes.root?.pos).toBeUndefined(); // root has no parent to be relative to
    expect(graph.nodes.child?.pos).toEqual({ x: 20, y: 20 });
  });

  it("emits a contains edge per child", () => {
    const a = html({ id: "a", tag: "div" });
    const b = html({ id: "b", tag: "div" });
    const root = html({ id: "root", tag: "div", children: [a, b] });

    const edges = buildSemanticGraphFromHtml(root).edges;

    expect(edges).toContainEqual({ from: "root", to: "a", kind: "contains" });
    expect(edges).toContainEqual({ from: "root", to: "b", kind: "contains" });
  });

  it("tags every node with the html sourceRef adapter", () => {
    const root = html({ id: "root", tag: "div" });

    expect(buildSemanticGraphFromHtml(root).nodes.root?.sourceRef).toEqual({ adapter: "html", nativeId: "root" });
  });
});

describe("RoleEnricher runs UNCHANGED on an HTML-sourced graph — the adapter-agnostic claim, proven", () => {
  it("classifies nav/hero/footer on a page built from stacked (non-flex) block sections, ordered by real position", () => {
    const link1 = html({ id: "link1", tag: "a", text: "Home", pos: { x: 20, y: 10 }, box: { w: 40, h: 16 } });
    const link2 = html({ id: "link2", tag: "a", text: "Docs", pos: { x: 80, y: 10 }, box: { w: 40, h: 16 } });
    const nav = html({
      id: "nav",
      tag: "nav",
      pos: { x: 0, y: 0 },
      box: { w: 1200, h: 64 },
      style: { display: "flex", flexDirection: "row" },
      children: [link1, link2],
    });

    const headline = html({
      id: "headline",
      tag: "h1",
      text: "Ship faster",
      pos: { x: 0, y: 64 },
      box: { w: 400, h: 60 },
      style: { fontSize: "48px" },
    });
    const hero = html({ id: "hero", tag: "section", pos: { x: 0, y: 64 }, box: { w: 1200, h: 400 }, children: [headline] });

    const footerLink = html({ id: "flink", tag: "a", text: "Contact", pos: { x: 0, y: 470 }, box: { w: 100, h: 16 } });
    const footer = html({
      id: "footer",
      tag: "footer",
      pos: { x: 0, y: 464 },
      box: { w: 1200, h: 120 },
      children: [footerLink],
    });

    // Deliberately NOT flex — a plain stacked-block page, the most common
    // real-world "not every wrapper uses flexbox" case.
    const body = html({
      id: "body",
      tag: "body",
      pos: { x: 0, y: 0 },
      box: { w: 1200, h: 2000 },
      children: [nav, hero, footer],
    });

    const graph = buildSemanticGraphFromHtml(body);
    const labels = new Map(RoleEnricher.run(graph).map((a) => [a.nodeId, a.value]));

    expect(labels.get("nav")).toBe("nav");
    expect(labels.get("hero")).toBe("hero");
    expect(labels.get("footer")).toBe("footer");
  });
});

describe("buildSemanticGraphFromHtml — extended style fidelity (M9.1)", () => {
  it("wires opacity through (was captured but silently dropped before this pass)", () => {
    const node = html({ tag: "div", style: { opacity: "0.5" } });

    expect(buildSemanticGraphFromHtml(node).nodes[node.id]?.style.opacity).toBe(0.5);
  });

  it("omits opacity at the CSS default (1)", () => {
    const node = html({ tag: "div", style: { opacity: "1" } });

    expect(buildSemanticGraphFromHtml(node).nodes[node.id]?.style.opacity).toBeUndefined();
  });

  it("parses a gradient background into style.fills, and does not also set fillColor for it", () => {
    const node = html({
      tag: "div",
      style: { backgroundImage: "linear-gradient(90deg, rgb(12, 140, 233) 0%, rgb(255, 0, 102) 100%)" },
    });

    const style = buildSemanticGraphFromHtml(node).nodes[node.id]?.style;
    expect(style?.fills).toEqual([
      { type: "linear-gradient", angle: 90, stops: [{ at: 0, color: "#0c8ce9" }, { at: 1, color: "#ff0066" }] },
    ]);
    expect(style?.fillColor).toBeUndefined();
  });

  it("falls back to solid fillColor when backgroundImage isn't a parseable gradient", () => {
    const node = html({ tag: "div", style: { backgroundColor: "rgb(255, 255, 255)", backgroundImage: "none" } });

    const style = buildSemanticGraphFromHtml(node).nodes[node.id]?.style;
    expect(style?.fillColor).toBe("#ffffff");
    expect(style?.fills).toBeUndefined();
  });

  it("parses box-shadow into style.effects", () => {
    const node = html({ tag: "div", style: { boxShadow: "rgba(0, 0, 0, 0.1) 0px 4px 6px -1px" } });

    expect(buildSemanticGraphFromHtml(node).nodes[node.id]?.style.effects).toEqual([
      { type: "drop-shadow", x: 0, y: 4, blur: 6, spread: -1, color: "#0000001a" },
    ]);
  });

  it("passes through backdrop-filter, preferring the standard prop", () => {
    const node = html({ tag: "div", style: { backdropFilter: "blur(24px)" } });

    expect(buildSemanticGraphFromHtml(node).nodes[node.id]?.style.backdropFilter).toBe("blur(24px)");
  });

  it("captures textAlign/textDecoration/letterSpacing/lineHeightPx on text nodes only", () => {
    const text = html({
      tag: "p",
      text: "hi",
      style: { textAlign: "center", textDecorationLine: "underline", letterSpacing: "0.5px", lineHeight: "24px" },
    });
    const container = html({
      tag: "div",
      children: [text],
      style: { textAlign: "center" }, // should be ignored — not a text node
    });

    const graph = buildSemanticGraphFromHtml(container);
    expect(graph.nodes[text.id]?.style).toMatchObject({
      textAlign: "center",
      textDecoration: "underline",
      letterSpacing: 0.5,
      lineHeightPx: 24,
    });
    expect(graph.nodes[container.id]?.style.textAlign).toBeUndefined();
  });

  it("omits textAlign at the CSS default (left/start)", () => {
    const node = html({ tag: "p", text: "hi", style: { textAlign: "left" } });

    expect(buildSemanticGraphFromHtml(node).nodes[node.id]?.style.textAlign).toBeUndefined();
  });

  it("captures position, but never 'static' (the CSS default)", () => {
    const fixed = html({ id: "fixed", tag: "div", style: { position: "fixed" } });
    const staticEl = html({ id: "static", tag: "div", style: { position: "static" } });

    expect(buildSemanticGraphFromHtml(fixed).nodes.fixed?.style.position).toBe("fixed");
    expect(buildSemanticGraphFromHtml(staticEl).nodes.static?.style.position).toBeUndefined();
  });
});
