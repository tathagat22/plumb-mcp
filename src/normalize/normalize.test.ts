import { describe, expect, it } from "vitest";
import type { FigmaFileResult, FigmaNode } from "../figma/types";
import { buildPreWalk, normalize } from "./normalize";

/**
 * End-to-end pipeline test: normalize() must still call through to the
 * semantic layer and land `pattern` on the wire-shaped PdsDocument exactly
 * as it did before the M2 Semantic Graph refactor
 * (docs/ROADMAP-v0.14-design-intelligence.md §10). Unit tests on the
 * individual layers (src/semantic/build.test.ts, role.test.ts) prove each
 * piece is correct in isolation; this proves they're actually wired
 * together.
 */
function landingPageFixture(): FigmaFileResult {
  const logo: FigmaNode = { id: "1", name: "Logo", type: "RECTANGLE", absoluteBoundingBox: { x: 0, y: 0, width: 40, height: 40 } };
  const links: FigmaNode = { id: "2", name: "Links", type: "RECTANGLE", absoluteBoundingBox: { x: 0, y: 0, width: 300, height: 20 } };
  const nav: FigmaNode = {
    id: "3",
    name: "Navbar",
    type: "FRAME",
    absoluteBoundingBox: { x: 0, y: 0, width: 1200, height: 64 },
    layoutMode: "HORIZONTAL",
    children: [logo, links],
  };

  const headline: FigmaNode = {
    id: "4",
    name: "Headline",
    type: "TEXT",
    absoluteBoundingBox: { x: 0, y: 0, width: 400, height: 60 },
    characters: "Ship faster",
    style: { fontSize: 48, fontWeight: 700, fontFamily: "Inter" },
  };
  const hero: FigmaNode = {
    id: "5",
    name: "Hero",
    type: "FRAME",
    absoluteBoundingBox: { x: 0, y: 64, width: 1200, height: 400 },
    children: [headline],
  };

  const footerLink: FigmaNode = {
    id: "6",
    name: "Footer link",
    type: "TEXT",
    absoluteBoundingBox: { x: 0, y: 0, width: 100, height: 16 },
    characters: "Contact",
    style: { fontSize: 14, fontWeight: 400, fontFamily: "Inter" },
  };
  const footer: FigmaNode = {
    id: "7",
    name: "Footer",
    type: "FRAME",
    absoluteBoundingBox: { x: 0, y: 464, width: 1200, height: 120 },
    children: [footerLink],
  };

  const root: FigmaNode = {
    id: "0",
    name: "Landing page",
    type: "FRAME",
    absoluteBoundingBox: { x: 0, y: 0, width: 1200, height: 2000 },
    layoutMode: "VERTICAL",
    children: [nav, hero, footer],
  };

  return { document: root, fileName: "test-file", version: "1" };
}

describe("normalize() — end-to-end semantic enrichment wiring", () => {
  it("lands role annotations on PdsNode.pattern for nav, hero, and footer", () => {
    const doc = normalize(landingPageFixture(), 5);
    const byName = (name: string) => Object.values(doc.nodes).find((n) => n.name === name);

    expect(byName("Navbar")?.pattern).toBe("nav");
    expect(byName("Hero")?.pattern).toBe("hero");
    expect(byName("Footer")?.pattern).toBe("footer");
  });
});

/** Builds a single-child chain `depth` frames deep — a narrow, pathologically
 *  nested tree (the shape a malformed/adversarial `.fig` import or REST
 *  payload could produce), as opposed to the wide, shallow fixtures above. */
function deepChain(depth: number): FigmaFileResult {
  let node: FigmaNode = {
    id: "leaf",
    name: "Leaf",
    type: "RECTANGLE",
    absoluteBoundingBox: { x: 0, y: 0, width: 10, height: 10 },
  };
  for (let i = depth; i >= 1; i--) {
    node = {
      id: `n${i}`,
      name: `Frame ${i}`,
      type: "FRAME",
      absoluteBoundingBox: { x: 0, y: 0, width: 100, height: 100 },
      children: [node],
    };
  }
  return { document: node, fileName: "deep-chain", version: "1" };
}

describe("buildPreWalk() — iterative traversal (Phase A5)", () => {
  it("handles a tree far deeper than the JS call stack without throwing", () => {
    // Comfortably beyond Node's default recursion limit (~10-15k simple
    // frames) — the whole point of the iterative rewrite is that depth no
    // longer matters. A recursive preWalk would throw `RangeError: Maximum
    // call stack size exceeded` here.
    expect(() => buildPreWalk(deepChain(50_000))).not.toThrow();
  });

  it("assigns the same left-to-right pre-order handles as before the rewrite", () => {
    // Three same-named siblings exercise the collision-suffix logic
    // (`button`, `button-2`, `button-3`) — a stack-based rewrite that
    // processed children in the wrong order would renumber these.
    const child = (n: number): FigmaNode => ({
      id: `c${n}`,
      name: "Button",
      type: "FRAME",
      absoluteBoundingBox: { x: 0, y: 0, width: 40, height: 40 },
    });
    const root: FigmaNode = {
      id: "root",
      name: "Row",
      type: "FRAME",
      absoluteBoundingBox: { x: 0, y: 0, width: 200, height: 40 },
      children: [child(1), child(2), child(3)],
    };
    const { elById } = buildPreWalk({ document: root, fileName: "f", version: "1" });
    expect(elById.get("c1")).toBe("button");
    expect(elById.get("c2")).toBe("button-2");
    expect(elById.get("c3")).toBe("button-3");
  });

  it("skips invisible subtrees, same as the recursive version did", () => {
    const hidden: FigmaNode = {
      id: "hidden",
      name: "Hidden",
      type: "FRAME",
      absoluteBoundingBox: { x: 0, y: 0, width: 10, height: 10 },
      visible: false,
      children: [
        { id: "hidden-child", name: "Should not appear", type: "RECTANGLE", absoluteBoundingBox: { x: 0, y: 0, width: 1, height: 1 } },
      ],
    };
    const root: FigmaNode = {
      id: "root",
      name: "Root",
      type: "FRAME",
      absoluteBoundingBox: { x: 0, y: 0, width: 100, height: 100 },
      children: [hidden],
    };
    const { elById } = buildPreWalk({ document: root, fileName: "f", version: "1" });
    expect(elById.has("hidden")).toBe(false);
    expect(elById.has("hidden-child")).toBe(false);
    expect(elById.has("root")).toBe(true);
  });
});
