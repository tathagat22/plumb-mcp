/**
 * Golden fixture set for RoleEnricher — precision/recall ground truth.
 *
 * These are the SAME scenarios exercised as exact-match unit tests in
 * `src/semantic/enrichers/role.test.ts`; this file exists for a different
 * job. Unit tests answer "does this one rule still fire correctly." This
 * benchmark answers "across the whole curated set, at once, what's the
 * enricher's precision/recall" — the shape that actually catches a change
 * which fixes one case while quietly breaking another.
 *
 * Honesty note (see docs/ROADMAP-v0.14-design-intelligence.md §9 / §11 item
 * 4): every fixture here is a case the classifier's rules were explicitly
 * designed against, not held-out real-world data. A perfect score proves
 * "no regression against the cases we already know about" — it does NOT
 * prove real-world generalization. Grow this set with real, weird files
 * (non-English headlines, RTL, unconventional design systems) before
 * trusting the floor as a generalization signal, not just a regression gate.
 *
 * `expected[nodeId]`: a role string the enricher MUST produce, or `null` for
 * a hard negative — a node the enricher must NOT label (a near-miss that
 * looks tempting but fails on a specific signal). Nodes with no entry are
 * simply not scored — most nodes in any graph rightly have no role, and
 * requiring ground truth for all of them would be absurd.
 */
import type { CirEdge, CirNode, SemanticGraph } from "../../src/semantic/graph";

export interface RoleFixture {
  name: string;
  graph: SemanticGraph;
  expected: Record<string, string | null>;
}

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

export const ROLE_FIXTURES: RoleFixture[] = (() => {
  const fixtures: RoleFixture[] = [];

  // --- landing page: nav + hero + footer, all should fire -----------------
  {
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
    fixtures.push({
      name: "landing-page",
      graph: graph(root, [logo, links, nav, h1, hero, flink, footer]),
      expected: { nav: "nav", hero: "hero", footer: "footer" },
    });
  }

  // --- narrow row that LOOKS like a nav but isn't wide enough — hard negative
  {
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
    fixtures.push({
      name: "narrow-row-not-nav",
      graph: graph(root, [a, b, narrowRow, other]),
      expected: { narrowRow: null },
    });
  }

  // --- wide/tall section with only body-sized text — hard negative for hero
  {
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
    fixtures.push({
      name: "body-text-section-not-hero",
      graph: graph(root, [small, section, filler]),
      expected: { section: null },
    });
  }

  // --- dashboard: sidebar + main -------------------------------------------
  {
    const sidebar = node({ id: "sidebar", kind: "container", box: { w: 240, h: 950 } });
    const main = node({ id: "main", kind: "container", box: { w: 960, h: 950 } });
    const root = node({
      id: "root",
      kind: "container",
      box: { w: 1200, h: 1000 },
      children: ["sidebar", "main"],
      style: { layout: { flow: "row", pad: [0, 0, 0, 0] } },
    });
    fixtures.push({
      name: "dashboard-sidebar",
      graph: graph(root, [sidebar, main]),
      expected: { sidebar: "sidebar", main: null },
    });
  }

  // --- free-canvas ordering by pos, not children[] order -------------------
  {
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
    const root = node({ id: "root", kind: "container", box: { w: 1200, h: 1600 }, children: ["footer", "hero"] });
    fixtures.push({
      name: "free-canvas-ordering",
      graph: graph(root, [flink, footer, h1, hero]),
      expected: { hero: "hero", footer: "footer" },
    });
  }

  // --- pricing cards: repeat-group template with surface + text -----------
  {
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
    fixtures.push({
      name: "pricing-cards",
      graph: graph(root, [label, template, list], [{ from: "list", to: "cardTemplate", kind: "repeats" }]),
      expected: { cardTemplate: "card" },
    });
  }

  // --- plain repeated list row, no surface styling — hard negative for card
  {
    const label = node({ id: "rowLabel", kind: "text", box: { w: 80, h: 16 }, chars: "Item" });
    const template = node({ id: "rowTemplate", kind: "container", box: { w: 800, h: 40 }, children: ["rowLabel"] });
    const list = node({ id: "list", kind: "container", box: { w: 800, h: 200 }, children: ["rowTemplate"] });
    const root = node({ id: "root", kind: "container", box: { w: 800, h: 400 }, children: ["list"] });
    fixtures.push({
      name: "plain-list-not-card",
      graph: graph(root, [label, template, list], [{ from: "list", to: "rowTemplate", kind: "repeats" }]),
      expected: { rowTemplate: null },
    });
  }

  return fixtures;
})();
