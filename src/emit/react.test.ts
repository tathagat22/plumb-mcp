import { describe, expect, it } from "vitest";
import { lowerToReact } from "./react";
import type { CirEdge, CirNode, SemanticGraph } from "../semantic/graph";

let nextId = 0;

function node(partial: Partial<CirNode> & { kind: CirNode["kind"] }): CirNode {
  const id = partial.id ?? `n${nextId++}`;
  return {
    id,
    box: { w: 100, h: 100 },
    children: [],
    style: {},
    sourceRef: { adapter: "html", nativeId: id },
    ...partial,
  };
}

function graph(root: CirNode, all: CirNode[], edges: CirEdge[] = []): SemanticGraph {
  const nodes: Record<string, CirNode> = {};
  for (const n of all) nodes[n.id] = n;
  nodes[root.id] = root;
  return { cirVersion: "1.0.0", root: root.id, nodes, edges };
}

describe("lowerToReact — basic shape", () => {
  it("wraps the render in a named default-export function component", () => {
    const root = node({ id: "root", kind: "container" });
    const { code } = lowerToReact(graph(root, []), { componentName: "Hero" });

    expect(code).toContain("export default function Hero()");
    expect(code).toContain("return (");
  });

  it("renders a text node as a tag with the text as a JSX expression child", () => {
    const text = node({ id: "text", kind: "text", chars: "Ship faster" });
    const { code } = lowerToReact(graph(text, []));

    expect(code).toContain('{"Ship faster"}');
  });

  it("safely escapes quotes and special characters in text content", () => {
    const text = node({ id: "text", kind: "text", chars: 'She said "hello" \n twice' });
    const { code, warnings } = lowerToReact(graph(text, []));

    expect(warnings).toHaveLength(0);
    expect(() => JSON.parse(code.match(/\{("(?:[^"\\]|\\.)*")\}/)?.[1] ?? "")).not.toThrow();
  });

  it("renders an image node as <img src=...> using the captured imageSrc", () => {
    const img = node({ id: "img", kind: "image", imageSrc: "https://example.com/photo.jpg" });
    const { code, warnings } = lowerToReact(graph(img, []));

    expect(code).toContain('src={"https://example.com/photo.jpg"}');
    expect(warnings).toHaveLength(0);
  });

  it("warns (does not throw) when an image node has no captured src", () => {
    const img = node({ id: "img", kind: "image" });
    const { warnings } = lowerToReact(graph(img, []));

    expect(warnings.some((w) => w.includes("no captured src"))).toBe(true);
  });

  it("warns and renders an empty box for a vector node — no path is fabricated", () => {
    const vec = node({ id: "vec", kind: "vector" });
    const { code, warnings } = lowerToReact(graph(vec, []));

    expect(code).toContain("<div");
    expect(warnings.some((w) => w.includes("vector"))).toBe(true);
  });
});

describe("lowerToReact — layout and positioning", () => {
  it("maps a flex layout to display/flexDirection/gap/justifyContent/alignItems", () => {
    const child = node({ id: "child", kind: "container" });
    const root = node({
      id: "root",
      kind: "container",
      children: ["child"],
      style: { layout: { flow: "row", pad: [8, 12, 8, 12], gap: 16, justify: "space-between", align: "center" } },
    });
    const { code } = lowerToReact(graph(root, [child]));

    expect(code).toContain('display: "flex"');
    expect(code).toContain('flexDirection: "row"');
    expect(code).toContain("gap: 16");
    expect(code).toContain('justifyContent: "space-between"');
    expect(code).toContain('alignItems: "center"');
  });

  it("positions a child absolutely from its pos when the parent has no layout", () => {
    const child = node({ id: "child", kind: "container", pos: { x: 20, y: 40 } });
    const root = node({ id: "root", kind: "container", children: ["child"] });
    const { code } = lowerToReact(graph(root, [child]));

    expect(code).toContain('position: "absolute"');
    expect(code).toContain("left: 20");
    expect(code).toContain("top: 40");
  });

  it("does not position a flex child absolutely — document order/flex handles it", () => {
    const child = node({ id: "child", kind: "container", pos: { x: 20, y: 40 } });
    const root = node({
      id: "root",
      kind: "container",
      children: ["child"],
      style: { layout: { flow: "col", pad: [0, 0, 0, 0] } },
    });
    const { code } = lowerToReact(graph(root, [child]));

    // Only the root's own `position: "relative"` should appear — the flex
    // child must not also get position:absolute.
    expect(code.match(/position:/g)?.length).toBe(1);
  });
});

describe("lowerToReact — fills, effects, and the lineHeight unit trap", () => {
  it("renders a solid fillColor as backgroundColor on a container, color on text", () => {
    const box = node({ id: "box", kind: "container", style: { fillColor: "#0c8ce9" } });
    const text = node({ id: "text", kind: "text", chars: "hi", style: { fillColor: "#ff0000" } });

    expect(lowerToReact(graph(box, [])).code).toContain('backgroundColor: "#0c8ce9"');
    expect(lowerToReact(graph(text, [])).code).toContain('color: "#ff0000"');
  });

  it("renders a linear-gradient fill as backgroundImage, and does not ALSO emit backgroundColor", () => {
    const box = node({
      id: "box",
      kind: "container",
      style: {
        fillColor: "#000000", // should be ignored — fills takes precedence
        fills: [{ type: "linear-gradient", angle: 90, stops: [{ at: 0, color: "#0c8ce9" }, { at: 1, color: "#ff0066" }] }],
      },
    });
    const { code } = lowerToReact(graph(box, []));

    expect(code).toContain("linear-gradient(90deg, #0c8ce9 0%, #ff0066 100%)");
    expect(code).not.toContain("backgroundColor");
  });

  it("renders a multi-layer effects stack as one boxShadow string", () => {
    const box = node({
      id: "box",
      kind: "container",
      style: {
        effects: [
          { type: "drop-shadow", x: 0, y: 4, blur: 6, spread: -1, color: "#0000001a" },
          { type: "drop-shadow", x: 0, y: 2, blur: 4, spread: -2, color: "#0000000f" },
        ],
      },
    });
    const { code } = lowerToReact(graph(box, []));

    expect(code).toContain("0px 4px 6px -1px #0000001a, 0px 2px 4px -2px #0000000f");
  });

  it("renders an inner-shadow with the CSS inset keyword", () => {
    const box = node({
      id: "box",
      kind: "container",
      style: { effects: [{ type: "inner-shadow", x: 0, y: 1, blur: 2, spread: 0, color: "#000000" }] },
    });

    expect(lowerToReact(graph(box, [])).code).toContain("inset 0px 1px 2px 0px #000000");
  });

  it("emits lineHeight as a px STRING, never a bare number — React treats a bare number as a unitless multiplier, not px", () => {
    const text = node({ id: "text", kind: "text", chars: "hi", style: { lineHeightPx: 24 } });
    const { code } = lowerToReact(graph(text, []));

    expect(code).toContain('lineHeight: "24px"');
    expect(code).not.toMatch(/lineHeight:\s*24[,\s}]/); // a bare `lineHeight: 24` would be the bug
  });

  it("maps a 'full' border radius to a large px value (9999px), not the literal string 'full'", () => {
    const box = node({ id: "box", kind: "container", style: { borderRadius: "full" } });
    const { code } = lowerToReact(graph(box, []));

    expect(code).toContain('borderRadius: "9999px"');
  });

  it("emits a numeric px border radius as a bare number", () => {
    const box = node({ id: "box", kind: "container", style: { borderRadius: 8 } });

    expect(lowerToReact(graph(box, [])).code).toContain("borderRadius: 8");
  });
});

describe("lowerToReact — role-aware tags", () => {
  it("uses a semantic tag for nav/footer/sidebar roles instead of a bare div", () => {
    const navNode = node({ id: "nav", kind: "container" });
    const footerNode = node({ id: "footer", kind: "container" });
    const sidebarNode = node({ id: "sidebar", kind: "container" });

    expect(lowerToReact(graph(navNode, []), { roleByNode: new Map([["nav", "nav"]]) }).code).toContain("<nav");
    expect(lowerToReact(graph(footerNode, []), { roleByNode: new Map([["footer", "footer"]]) }).code).toContain(
      "<footer",
    );
    expect(lowerToReact(graph(sidebarNode, []), { roleByNode: new Map([["sidebar", "sidebar"]]) }).code).toContain(
      "<aside",
    );
  });

  it("falls back to div for a role with no semantic HTML5 equivalent (hero/card)", () => {
    const hero = node({ id: "hero", kind: "container" });

    expect(lowerToReact(graph(hero, []), { roleByNode: new Map([["hero", "hero"]]) }).code).toContain("<div");
  });
});

describe("lowerToReact — text styling", () => {
  it("emits textTransform for a textCase'd node, working from either source", () => {
    const upperFromFigma = node({
      id: "upper",
      kind: "text",
      chars: "SHOP NOW",
      style: { textCase: "UPPER" },
      sourceRef: { adapter: "figma", nativeId: "1:1" },
    });
    const { code } = lowerToReact(graph(upperFromFigma, []));

    expect(code).toContain('textTransform: "uppercase"');
  });
});

describe("lowerToReact — CSS Grid (Phase F5)", () => {
  it("emits display:grid + gridTemplateColumns/rowGap/columnGap instead of flex", () => {
    const card = node({ id: "card", kind: "container" });
    const grid = node({
      id: "grid",
      kind: "container",
      children: ["card"],
      style: { layout: { flow: "grid", pad: [0, 0, 0, 0], columns: "384px 384px 384px", gap: 24, gapCross: 16 } },
    });
    const { code } = lowerToReact(graph(grid, [card]));

    expect(code).toContain('display: "grid"');
    expect(code).toContain('gridTemplateColumns: "384px 384px 384px"');
    expect(code).toContain("columnGap: 24");
    expect(code).toContain("rowGap: 16");
    expect(code).not.toContain('display: "flex"');
  });

  it("does not apply flex responsive-sizing (flexGrow/alignSelf) to a grid child", () => {
    const item = node({ id: "item", kind: "container", box: { w: 50, h: 50 }, style: { sizing: { w: "fill" } } });
    const grid = node({
      id: "grid",
      kind: "container",
      children: ["item"],
      style: { layout: { flow: "grid", pad: [0, 0, 0, 0], columns: "1fr 1fr" } },
    });
    const { code } = lowerToReact(graph(grid, [item]));

    expect(code).not.toContain("flexGrow");
    expect(code).toContain("width: 50"); // stays pixel-faithful under a grid parent
  });
});

describe("lowerToReact — fontFamily (Phase F3)", () => {
  it("emits fontFamily for a text node that carries one", () => {
    const text = node({ id: "text", kind: "text", chars: "Ship faster", style: { fontFamily: "Inter" } });
    const { code } = lowerToReact(graph(text, []));

    expect(code).toContain('fontFamily: "Inter"');
  });

  it("omits fontFamily when the node has none", () => {
    const text = node({ id: "text", kind: "text", chars: "Ship faster" });
    const { code } = lowerToReact(graph(text, []));

    expect(code).not.toContain("fontFamily");
  });
});

describe("lowerToReact — responsive sizing (Phase E)", () => {
  it("emits flexGrow instead of a pixel width for a fill-sized child of a row parent", () => {
    const child = node({ id: "child", kind: "container", style: { sizing: { w: "fill" } } });
    const root = node({
      id: "root",
      kind: "container",
      children: ["child"],
      style: { layout: { flow: "row", pad: [0, 0, 0, 0] } },
    });
    const { code } = lowerToReact(graph(root, [child]));

    expect(code).toContain("flexGrow: 1");
    expect(code).not.toMatch(/child[\s\S]*width:/);
  });

  it("emits flexGrow from an explicit grow factor, on whichever axis is the parent's main axis", () => {
    const child = node({ id: "child", kind: "container", style: { grow: 2 } });
    const root = node({
      id: "root",
      kind: "container",
      children: ["child"],
      style: { layout: { flow: "col", pad: [0, 0, 0, 0] } },
    });
    const { code } = lowerToReact(graph(root, [child]));

    expect(code).toContain("flexGrow: 2");
  });

  it("omits the pixel size (lets content dictate) for a hug-sized child", () => {
    const child = node({ id: "child", kind: "container", box: { w: 50, h: 20 }, style: { sizing: { h: "hug" } } });
    const root = node({
      id: "root",
      kind: "container",
      children: ["child"],
      style: { layout: { flow: "col", pad: [0, 0, 0, 0] } },
    });
    const { code } = lowerToReact(graph(root, [child]));

    expect(code).not.toMatch(/child[\s\S]*height:\s*20/);
    expect(code).toContain("width: 50"); // cross axis, untouched — still pixel-faithful
  });

  it("emits alignSelf: stretch for a cross-axis fill, and omits that axis's pixel size", () => {
    const child = node({ id: "child", kind: "container", box: { w: 50, h: 20 }, style: { sizing: { h: "fill" } } });
    const root = node({
      id: "root",
      kind: "container",
      children: ["child"],
      style: { layout: { flow: "row", pad: [0, 0, 0, 0] } },
    });
    const { code } = lowerToReact(graph(root, [child]));

    expect(code).toContain('alignSelf: "stretch"');
    expect(code).not.toMatch(/child[\s\S]*height:/);
  });

  it("stays pixel-faithful (unchanged) when the parent has no flex layout", () => {
    const child = node({ id: "child", kind: "container", box: { w: 50, h: 20 }, style: { sizing: { w: "fill" } } });
    const root = node({ id: "root", kind: "container", children: ["child"] }); // no layout on root
    const { code } = lowerToReact(graph(root, [child]));

    expect(code).toContain("width: 50");
    expect(code).toContain("height: 20");
    expect(code).not.toContain("flexGrow");
  });

  it("stays pixel-faithful for the root itself even if it declares sizing", () => {
    const root = node({ id: "root", kind: "container", box: { w: 1440, h: 900 }, style: { sizing: { w: "fill" } } });
    const { code } = lowerToReact(graph(root, []));

    expect(code).toContain("width: 1440");
    expect(code).not.toContain("flexGrow");
  });
});

describe("lowerToReact — vectors render real content, not blank boxes (Phase F1)", () => {
  it("renders an inline <svg><path/> for a Figma-sourced vectorPath", () => {
    const icon = node({ id: "icon", kind: "vector", box: { w: 24, h: 24 }, vectorPath: "M0 0h24v24H0z" });
    const { code, warnings } = lowerToReact(graph(icon, []));

    expect(code).toContain("<svg");
    expect(code).toContain('d={"M0 0h24v24H0z"}');
    expect(warnings).toHaveLength(0);
  });

  it("renders dangerouslySetInnerHTML for an HTML-sourced svgMarkup", () => {
    const markup = '<svg viewBox="0 0 24 24"><path d="M0 0h24v24H0z"/></svg>';
    const icon = node({ id: "icon", kind: "vector", box: { w: 24, h: 24 }, svgMarkup: markup });
    const { code, warnings } = lowerToReact(graph(icon, []));

    expect(code).toContain("dangerouslySetInnerHTML");
    expect(code).toContain(JSON.stringify(markup));
    expect(warnings).toHaveLength(0);
  });

  it("still warns and renders an empty box when neither is present", () => {
    const icon = node({ id: "icon", kind: "vector", box: { w: 24, h: 24 } });
    const { code, warnings } = lowerToReact(graph(icon, []));

    expect(code).not.toContain("<svg");
    expect(code).not.toContain("dangerouslySetInnerHTML");
    expect(warnings.some((w) => w.includes("no vector path is reproduced"))).toBe(true);
  });
});

describe("lowerToReact — degrades per-node instead of throwing", () => {
  it("skips a missing child (a dangling reference) with a warning, and still renders the rest", () => {
    const present = node({ id: "present", kind: "text", chars: "here" });
    const root = node({ id: "root", kind: "container", children: ["present", "missing"] });
    const { code, warnings } = lowerToReact(graph(root, [present]));

    expect(code).toContain('{"here"}');
    expect(warnings.some((w) => w.includes('"missing"'))).toBe(true);
  });
});
