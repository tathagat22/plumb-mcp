import { describe, expect, it } from "vitest";
import type { FigmaFileResult, FigmaNode } from "../figma/types";
import { normalize } from "./normalize";

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
