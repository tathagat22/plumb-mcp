import { describe, expect, it } from "vitest";
import type { PdsDocument, PdsNode, TokenTable } from "../../pds";
import { collapseByRole } from "./collapse";

const EMPTY_TOKENS: TokenTable = { color: {}, text: {}, radius: {}, shadow: {} };

function doc(nodes: Record<string, PdsNode>, root: string): PdsDocument {
  return {
    schemaVersion: "1.0.0",
    file: { name: "test", version: "1" },
    root,
    tokens: EMPTY_TOKENS,
    nodes,
    meta: { nodeCount: Object.keys(nodes).length, estTokens: 1000, depthUsed: 6 },
    next: "",
  };
}

describe("collapseByRole", () => {
  it("collapses a matching subtree: children removed, more set to the hidden count, summary present", () => {
    const link = { id: "1", el: "link", type: "text", box: { w: 40, h: 16 }, chars: "Contact" } satisfies PdsNode;
    const footer = {
      id: "2",
      el: "footer",
      type: "frame",
      box: { w: 1200, h: 120 },
      pattern: "footer",
      children: ["link"],
    } satisfies PdsNode;
    const hero = { id: "3", el: "hero", type: "frame", box: { w: 1200, h: 400 } } satisfies PdsNode;
    const root = {
      id: "0",
      el: "root",
      type: "frame",
      box: { w: 1200, h: 2000 },
      children: ["hero", "footer"],
    } satisfies PdsNode;

    const input = doc({ root, hero, footer, link }, "root");
    const result = collapseByRole(input, new Set(["footer"]));

    expect(result.nodes.footer?.children).toBeUndefined();
    expect(result.nodes.footer?.more).toBe(1); // the "link" descendant
    expect(result.nodes.footer?.summary).toContain("footer");
    expect(result.nodes.footer?.summary).toContain("1200×120");
    expect(result.nodes.link).toBeUndefined(); // deleted, the actual savings
    expect(result.nodes.hero).toBeDefined(); // untouched — not a matched role
  });

  it("leaves non-matching roles untouched", () => {
    const hero = { id: "1", el: "hero", type: "frame", box: { w: 1200, h: 400 }, pattern: "hero", children: [] } satisfies PdsNode;
    const root = { id: "0", el: "root", type: "frame", box: { w: 1200, h: 2000 }, children: ["hero"] } satisfies PdsNode;

    const result = collapseByRole(doc({ root, hero }, "root"), new Set(["footer"]));

    expect(result.nodes.hero?.summary).toBeUndefined();
  });

  it("does not recurse into a collapsed subtree — a nested role match inside it is simply gone", () => {
    const nestedCard = { id: "1", el: "card", type: "frame", box: { w: 200, h: 100 }, pattern: "card" } satisfies PdsNode;
    const footer = {
      id: "2",
      el: "footer",
      type: "frame",
      box: { w: 1200, h: 200 },
      pattern: "footer",
      children: ["card"],
    } satisfies PdsNode;
    const root = { id: "0", el: "root", type: "frame", box: { w: 1200, h: 2000 }, children: ["footer"] } satisfies PdsNode;

    const result = collapseByRole(doc({ root, footer, nestedCard }, "root"), new Set(["footer", "card"]));

    expect(result.nodes.footer?.summary).toBeDefined();
    expect(result.nodes.card).toBeUndefined(); // deleted along with the rest of footer's subtree
  });

  it("returns the input unchanged (same node identities) when roles is empty", () => {
    const hero = { id: "1", el: "hero", type: "frame", box: { w: 1, h: 1 }, pattern: "hero" } satisfies PdsNode;
    const root = { id: "0", el: "root", type: "frame", box: { w: 1, h: 1 }, children: ["hero"] } satisfies PdsNode;
    const input = doc({ root, hero }, "root");

    expect(collapseByRole(input, new Set())).toBe(input);
  });

  it("includes up to 3 short child descriptors, and an ellipsis when there are more", () => {
    const kids: Record<string, PdsNode> = {};
    const kidEls: string[] = [];
    for (let i = 0; i < 5; i++) {
      const el = `k${i}`;
      kids[el] = { id: String(i), el, type: "text", box: { w: 10, h: 10 }, chars: `Item ${i}` };
      kidEls.push(el);
    }
    const nav = { id: "n", el: "nav", type: "frame", box: { w: 1200, h: 60 }, pattern: "nav", children: kidEls } satisfies PdsNode;
    const root = { id: "0", el: "root", type: "frame", box: { w: 1200, h: 2000 }, children: ["nav"] } satisfies PdsNode;

    const result = collapseByRole(doc({ root, nav, ...kids }, "root"), new Set(["nav"]));

    expect(result.nodes.nav?.summary).toContain("5 children");
    expect(result.nodes.nav?.summary).toContain("…");
    expect(result.nodes.nav?.more).toBe(5);
  });

  it("shrinks meta.estTokens after a real collapse, vs. the same recompute path with no matches", () => {
    const link = { id: "1", el: "link", type: "text", box: { w: 40, h: 16 }, chars: "A fairly long piece of footer copy to pad out the token estimate" } satisfies PdsNode;
    const footer = { id: "2", el: "footer", type: "frame", box: { w: 1200, h: 120 }, pattern: "footer", children: ["link"] } satisfies PdsNode;
    const root = { id: "0", el: "root", type: "frame", box: { w: 1200, h: 2000 }, children: ["footer"] } satisfies PdsNode;
    const input = doc({ root, footer, link }, "root");

    // Same function, same recompute path, but a role that matches nothing —
    // an apples-to-apples "before" that isn't the fixture's hardcoded stub.
    const unchanged = collapseByRole(input, new Set(["nonexistent-role"]));
    const collapsed = collapseByRole(input, new Set(["footer"]));

    expect(collapsed.meta.estTokens).toBeLessThan(unchanged.meta.estTokens);
    expect(collapsed.meta.nodeCount).toBe(2); // root + collapsed footer, link is gone
  });
});
