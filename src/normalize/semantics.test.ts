import { describe, expect, it } from "vitest";
import type { PdsNode, TokenTable } from "../pds";
import { classifySemantics } from "./semantics";

let nextId = 0;

/** Minimal PdsNode builder — only the fields a test cares about. */
function node(partial: Partial<PdsNode> & { type: PdsNode["type"] }): PdsNode {
  const id = String(nextId++);
  return {
    id,
    el: partial.el ?? `n${id}`,
    box: { w: 0, h: 0 },
    ...partial,
  };
}

const EMPTY_TOKENS: TokenTable = { color: {}, text: {}, radius: {}, shadow: {} };

/** Wires `children[].el` and registers every node (recursively) in the map. */
function tree(nodes: Record<string, PdsNode>, root: PdsNode, kids: PdsNode[]): PdsNode {
  root.children = kids.map((k) => k.el);
  for (const k of kids) nodes[k.el] = k;
  nodes[root.el] = root;
  return root;
}

function headline(text: string, px: number, tRef = "$t1"): PdsNode {
  return node({ el: `text-${text}`, type: "text", box: { w: 400, h: px * 1.2 }, text: tRef, chars: text });
}

describe("classifySemantics — sections (nav/hero/footer/sidebar)", () => {
  it("labels a full-width row-flow first child as nav, a tall wide second child as hero, and a short wide last child as footer", () => {
    const nodes: Record<string, PdsNode> = {};
    const tokens: TokenTable = { ...EMPTY_TOKENS, text: { $t1: "700 48px/1.1 Inter" } };

    const logo = node({ el: "logo", type: "frame", box: { w: 40, h: 40 } });
    const links = node({ el: "links", type: "frame", box: { w: 300, h: 20 } });
    const nav = node({
      el: "nav",
      type: "frame",
      box: { w: 1200, h: 64 },
      layout: { flow: "row", pad: [0, 0, 0, 0] },
    });
    nav.children = [logo.el, links.el];
    nodes[logo.el] = logo;
    nodes[links.el] = links;

    const hero = node({ el: "hero", type: "frame", box: { w: 1200, h: 400 } });
    hero.children = [headline("Ship faster", 48).el];
    nodes[hero.children[0]!] = headline("Ship faster", 48);

    const footerLink = node({ el: "footer-link", type: "text", box: { w: 100, h: 16 } });
    const footer = node({ el: "footer", type: "frame", box: { w: 1200, h: 120 } });
    footer.children = [footerLink.el];
    nodes[footerLink.el] = footerLink;

    const root = node({
      el: "root",
      type: "frame",
      box: { w: 1200, h: 2000 },
      layout: { flow: "col", pad: [0, 0, 0, 0] },
    });
    tree(nodes, root, [nav, hero, footer]);

    classifySemantics(root.el, nodes, tokens);

    expect(nodes["nav"]!.pattern).toBe("nav");
    expect(nodes["hero"]!.pattern).toBe("hero");
    expect(nodes["footer"]!.pattern).toBe("footer");
  });

  it("does not label a nav-shaped section that isn't near full width (avoids false positives on small row widgets)", () => {
    const nodes: Record<string, PdsNode> = {};
    const a = node({ el: "a", type: "text", box: { w: 20, h: 20 } });
    const b = node({ el: "b", type: "text", box: { w: 20, h: 20 } });
    const narrowRow = node({
      el: "narrowRow",
      type: "frame",
      box: { w: 200, h: 60 }, // 200/1200 = 17% of root width — not nav-wide
      layout: { flow: "row", pad: [0, 0, 0, 0] },
    });
    narrowRow.children = [a.el, b.el];
    nodes[a.el] = a;
    nodes[b.el] = b;

    const other = node({ el: "other", type: "frame", box: { w: 1200, h: 300 } });

    const root = node({
      el: "root",
      type: "frame",
      box: { w: 1200, h: 1000 },
      layout: { flow: "col", pad: [0, 0, 0, 0] },
    });
    tree(nodes, root, [narrowRow, other]);

    classifySemantics(root.el, nodes, EMPTY_TOKENS);

    expect(nodes["narrowRow"]!.pattern).toBeUndefined();
  });

  it("does not label a wide-and-tall section as hero when it has no headline-sized text", () => {
    const nodes: Record<string, PdsNode> = {};
    const smallText = node({ el: "small", type: "text", box: { w: 100, h: 16 }, text: "$t1", chars: "Learn more" });
    const section = node({ el: "section", type: "frame", box: { w: 1200, h: 400 } });
    section.children = [smallText.el];
    nodes[smallText.el] = smallText;

    const filler = node({ el: "filler", type: "frame", box: { w: 1200, h: 200 } });

    const root = node({
      el: "root",
      type: "frame",
      box: { w: 1200, h: 1000 },
      layout: { flow: "col", pad: [0, 0, 0, 0] },
    });
    tree(nodes, root, [section, filler]);

    const tokens: TokenTable = { ...EMPTY_TOKENS, text: { $t1: "400 14px/1.4 Inter" } };
    classifySemantics(root.el, nodes, tokens);

    expect(nodes["section"]!.pattern).toBeUndefined();
  });

  it("labels a narrow full-height first child of a row-flow root as sidebar", () => {
    const nodes: Record<string, PdsNode> = {};
    const sidebar = node({ el: "sidebar", type: "frame", box: { w: 240, h: 950 } });
    const main = node({ el: "main", type: "frame", box: { w: 960, h: 950 } });

    const root = node({
      el: "root",
      type: "frame",
      box: { w: 1200, h: 1000 },
      layout: { flow: "row", pad: [0, 0, 0, 0] },
    });
    tree(nodes, root, [sidebar, main]);

    classifySemantics(root.el, nodes, EMPTY_TOKENS);

    expect(nodes["sidebar"]!.pattern).toBe("sidebar");
    expect(nodes["main"]!.pattern).toBeUndefined();
  });

  it("respects absolute pos (free-canvas root) for nav/hero/footer ordering instead of children array order", () => {
    const nodes: Record<string, PdsNode> = {};
    const tokens: TokenTable = { ...EMPTY_TOKENS, text: { $t1: "700 40px/1.1 Inter" } };

    const footer = node({ el: "footer", type: "frame", box: { w: 1200, h: 100 }, pos: { x: 0, y: 1500 } });
    footer.children = ["flink"];
    nodes["flink"] = node({ el: "flink", type: "text", box: { w: 80, h: 16 } });

    const hero = node({ el: "hero", type: "frame", box: { w: 1200, h: 500 }, pos: { x: 0, y: 0 } });
    hero.children = ["h1"];
    nodes["h1"] = headline("Big headline", 40, "$t1");

    // Children array is deliberately out of visual order to prove pos wins.
    const root = node({ el: "root", type: "frame", box: { w: 1200, h: 1600 } });
    tree(nodes, root, [footer, hero]);

    classifySemantics(root.el, nodes, tokens);

    expect(nodes["hero"]!.pattern).toBe("hero");
    expect(nodes["footer"]!.pattern).toBe("footer");
  });

  it("never overwrites an existing pattern", () => {
    const nodes: Record<string, PdsNode> = {};
    const preTagged = node({
      el: "preTagged",
      type: "frame",
      box: { w: 1200, h: 64 },
      layout: { flow: "row", pad: [0, 0, 0, 0] },
      pattern: "button",
    });
    preTagged.children = ["x", "y"];
    nodes["x"] = node({ el: "x", type: "text", box: { w: 10, h: 10 } });
    nodes["y"] = node({ el: "y", type: "text", box: { w: 10, h: 10 } });

    const other = node({ el: "other", type: "frame", box: { w: 1200, h: 300 } });

    const root = node({
      el: "root",
      type: "frame",
      box: { w: 1200, h: 1000 },
      layout: { flow: "col", pad: [0, 0, 0, 0] },
    });
    tree(nodes, root, [preTagged, other]);

    classifySemantics(root.el, nodes, EMPTY_TOKENS);

    expect(nodes["preTagged"]!.pattern).toBe("button");
  });
});

describe("classifySemantics — card (repeat-group templates)", () => {
  it("labels a repeat-group template as card when it's a styled surface with its own text", () => {
    const nodes: Record<string, PdsNode> = {};
    const label = node({ el: "cardLabel", type: "text", box: { w: 80, h: 16 }, chars: "Pro plan" });
    const template = node({
      el: "cardTemplate",
      type: "frame",
      box: { w: 300, h: 200 },
      radius: "$r1",
      fill: "$c1",
      stroke: "$c2",
    });
    template.children = [label.el];
    nodes[label.el] = label;
    nodes[template.el] = template;

    const list = node({ el: "list", type: "frame", box: { w: 1000, h: 200 } });
    list.children = [template.el, "card2", "card3"];
    list.repeat = { template: template.el, data: {} };

    const root = node({ el: "root", type: "frame", box: { w: 1000, h: 400 } });
    root.children = [list.el];
    nodes[list.el] = list;
    nodes[root.el] = root;

    classifySemantics(root.el, nodes, EMPTY_TOKENS);

    expect(nodes["cardTemplate"]!.pattern).toBe("card");
  });

  it("does not label a repeated row as card when it has no surface styling (plain list row)", () => {
    const nodes: Record<string, PdsNode> = {};
    const label = node({ el: "rowLabel", type: "text", box: { w: 80, h: 16 }, chars: "Item" });
    const template = node({ el: "rowTemplate", type: "frame", box: { w: 800, h: 40 } });
    template.children = [label.el];
    nodes[label.el] = label;
    nodes[template.el] = template;

    const list = node({ el: "list", type: "frame", box: { w: 800, h: 200 } });
    list.children = [template.el, "row2", "row3"];
    list.repeat = { template: template.el, data: {} };

    const root = node({ el: "root", type: "frame", box: { w: 800, h: 400 } });
    root.children = [list.el];
    nodes[list.el] = list;
    nodes[root.el] = root;

    classifySemantics(root.el, nodes, EMPTY_TOKENS);

    expect(nodes["rowTemplate"]!.pattern).toBeUndefined();
  });

  it("handles multiple repeat groups on the same parent (repeat as an array)", () => {
    const nodes: Record<string, PdsNode> = {};
    const t1Label = node({ el: "t1Label", type: "text", box: { w: 60, h: 14 }, chars: "Basic" });
    const t1 = node({ el: "t1", type: "frame", box: { w: 240, h: 160 }, radius: "$r1" });
    t1.children = [t1Label.el];
    nodes[t1Label.el] = t1Label;
    nodes[t1.el] = t1;

    const t2Label = node({ el: "t2Label", type: "text", box: { w: 60, h: 14 }, chars: "Row" });
    const t2 = node({ el: "t2", type: "frame", box: { w: 240, h: 40 } });
    t2.children = [t2Label.el];
    nodes[t2Label.el] = t2Label;
    nodes[t2.el] = t2;

    const parent = node({ el: "parent", type: "frame", box: { w: 1000, h: 400 } });
    parent.children = [t1.el, "c2", "c3", t2.el, "r2", "r3"];
    parent.repeat = [
      { template: t1.el, data: {} },
      { template: t2.el, data: {} },
    ];

    const root = node({ el: "root", type: "frame", box: { w: 1000, h: 400 } });
    root.children = [parent.el];
    nodes[parent.el] = parent;
    nodes[root.el] = root;

    classifySemantics(root.el, nodes, EMPTY_TOKENS);

    expect(nodes["t1"]!.pattern).toBe("card"); // styled surface + text
    expect(nodes["t2"]!.pattern).toBeUndefined(); // no surface styling
  });
});
