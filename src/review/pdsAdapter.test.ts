import { describe, expect, it } from "vitest";
import { PRICING_PDS } from "../demo/fixture";
import type { PdsDocument, PdsNode } from "../pds";
import { verifyAgainst } from "../verify";
import { applyRemap, pdsToRendered, remapBuiltToAuthored } from "./pdsAdapter";

/**
 * The adapter that lets `plumb_review` grade a design Plumb just *wrote*.
 *
 * The verify engine compares an authored spec against a rendered build, and a
 * Figma file Plumb emitted is a rendered build — it just arrives as a second
 * PdsDocument rather than a DOM capture. Two things have to hold or the
 * comparison is meaningless: an emitted image must read as real content rather
 * than a redrawn box, and the built handles have to be translated back to the
 * authored ones, because emit mints its own namespace.
 */

const node = (el: string, over: Partial<PdsNode> = {}): PdsNode => ({
  id: `10:${el}`,
  el,
  type: "frame",
  box: { w: 100, h: 40 },
  ...over,
});

function doc(nodes: PdsNode[]): PdsDocument {
  const map: Record<string, PdsNode> = {};
  for (const n of nodes) map[n.el] = n;
  return {
    schemaVersion: "1.0.0",
    file: { name: "built", version: "1" },
    root: nodes[0]!.el,
    tokens: { color: { $c0: "#6366f1" }, text: { $t0: "600 16px/1.4 Inter" }, radius: {}, shadow: {} },
    nodes: map,
    meta: { nodeCount: nodes.length, estTokens: 0, depthUsed: 1 },
    next: "",
  };
}

describe("pdsToRendered", () => {
  it("emits one rendered element per node", () => {
    expect(pdsToRendered(PRICING_PDS)).toHaveLength(Object.keys(PRICING_PDS.nodes).length);
  });

  it("carries the box, defaulting position to the origin", () => {
    const [el] = pdsToRendered(doc([node("root", { box: { w: 300, h: 200 } })]));
    expect(el?.box).toEqual({ x: 0, y: 0, w: 300, h: 200 });
  });

  it("uses an explicit position when the node has one", () => {
    const [el] = pdsToRendered(doc([node("root", { pos: { x: 12, y: 34 } })]));
    expect(el?.box).toMatchObject({ x: 12, y: 34 });
  });

  it("carries text content", () => {
    const [el] = pdsToRendered(doc([node("t", { type: "text", chars: "Hello" })]));
    expect(el?.text).toBe("Hello");
  });

  it("leaves text unset for a node with mixed-style runs rather than guessing", () => {
    const [el] = pdsToRendered(doc([node("t", { type: "text", chars: [{ t: "a" }, { t: "b" }] })]));
    expect(el?.text).toBeUndefined();
  });

  it("reports an emitted asset as real content, not a redrawn box", () => {
    // Without this, verify's asset-fidelity check flags every image Plumb
    // itself emitted as "redrawn or omitted" — the review would fail its own
    // output.
    const [el] = pdsToRendered(doc([node("logo", { assetId: "9:9" })]));
    expect(el?.asset).toBe("9:9");
    expect(el?.img).toBe(true);
  });

  it("marks a vector node as image content even with no asset id", () => {
    expect(pdsToRendered(doc([node("v", { type: "vector" })]))[0]?.img).toBe(true);
    expect(pdsToRendered(doc([node("i", { type: "image" })]))[0]?.img).toBe(true);
    expect(pdsToRendered(doc([node("p", { vectorPath: "M0 0" })]))[0]?.img).toBe(true);
  });

  it("leaves an ordinary frame unmarked", () => {
    const [el] = pdsToRendered(doc([node("box")]));
    expect(el?.img).toBeUndefined();
    expect(el?.asset).toBeUndefined();
  });

  it("resolves token refs into concrete computed styles", () => {
    const [el] = pdsToRendered(doc([node("box", { fill: "$c0" })]));
    expect(JSON.stringify(el?.styles)).not.toContain("$c0");
    expect(Object.keys(el?.styles ?? {}).length).toBeGreaterThan(0);
  });

  it("round-trips a document against itself with a perfect score", () => {
    // The strongest statement of the adapter's contract: feeding a design back
    // in as its own build must produce no deltas. Anything else means the
    // adapter and the verify engine disagree about what a style is.
    const result = verifyAgainst(PRICING_PDS, pdsToRendered(PRICING_PDS));
    expect(result.deltas).toEqual([]);
    expect(result.unmatched).toBe(0);
  });

  it("handles an empty document", () => {
    expect(pdsToRendered({ ...doc([node("root")]), nodes: {} })).toEqual([]);
  });
});

describe("remapBuiltToAuthored", () => {
  const built = doc([
    node("frame-1", { id: "200:1" }),
    node("text-2", { id: "200:2", type: "text", chars: "Hi" }),
  ]);

  it("returns an empty map when emit reported no ids", () => {
    // The caller then falls back to a direct el join, which only lines up if
    // both sides happen to share a handle namespace — usually they don't.
    expect(remapBuiltToAuthored(built).size).toBe(0);
    expect(remapBuiltToAuthored(built, undefined).size).toBe(0);
  });

  it("maps built handles back to the authored ones via the Figma node id", () => {
    const remap = remapBuiltToAuthored(built, { hero: "200:1", headline: "200:2" });
    expect(remap.get("frame-1")).toBe("hero");
    expect(remap.get("text-2")).toBe("headline");
  });

  it("omits a built node that emit created but nobody authored", () => {
    // Left unmapped on purpose: verify then surfaces it as `missing-in-pds`,
    // which is exactly what "emit made something we didn't ask for" should
    // look like.
    const remap = remapBuiltToAuthored(built, { hero: "200:1" });
    expect(remap.has("text-2")).toBe(false);
  });

  it("ignores an id pointing at a node the built document does not contain", () => {
    const remap = remapBuiltToAuthored(built, { ghost: "999:9" });
    expect(remap.size).toBe(0);
  });

  it("handles an empty id map", () => {
    expect(remapBuiltToAuthored(built, {}).size).toBe(0);
  });
});

describe("applyRemap", () => {
  const rendered = pdsToRendered(doc([node("frame-1", { id: "200:1" })]));

  it("returns the input untouched for an empty remap", () => {
    expect(applyRemap(rendered, new Map())).toBe(rendered);
  });

  it("rewrites a mapped handle to its authored name", () => {
    const out = applyRemap(rendered, new Map([["frame-1", "hero"]]));
    expect(out[0]?.el).toBe("hero");
  });

  it("leaves an unmapped element's handle alone", () => {
    const out = applyRemap(rendered, new Map([["something-else", "x"]]));
    expect(out[0]?.el).toBe("frame-1");
  });

  it("does not mutate the input", () => {
    applyRemap(rendered, new Map([["frame-1", "hero"]]));
    expect(rendered[0]?.el).toBe("frame-1");
  });
});
