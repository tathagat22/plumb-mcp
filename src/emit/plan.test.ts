import { describe, expect, it } from "vitest";
import { PRICING_PDS } from "../demo/fixture";
import { compile } from "../dsl/compile";
import { landingDoc } from "../dsl/examples/landing";
import type { AssetResolver, AssetSpec, ResolvedAsset } from "../dsl/schema";
import type { EmitOp, EmitPlan } from "../bridge/protocol";
import { lowerToEmitPlan } from "./plan";

/**
 * The last step before Figma: a `PdsDocument` down to the `EmitPlan` the
 * plugin executor replays.
 *
 * The executor is mechanical by design contract — it creates the node it is
 * told to and assigns the values it is handed, with no maths and no
 * second-guessing. That makes this the last place a mistake can be caught, and
 * it is why the ordering rules matter as much as the values: fonts must be
 * declared before any text node needs them, and a parent must exist before a
 * child names it.
 *
 * Run against both a read-side PDS (the demo fixture, as extracted from Figma)
 * and a write-side one (compiled from the landing example) — the two must
 * lower identically, which is the symmetry claim made good.
 */

const assets: AssetResolver = {
  resolve: (spec: AssetSpec): Promise<ResolvedAsset> =>
    Promise.resolve({
      kind: spec.kind ?? "photo",
      assetId: `a-${spec.query}`,
      w: 800,
      h: 600,
      ...(spec.kind === "icon" ? { vectorPath: "M0 0 L8 8" } : { url: "https://x/y.png" }),
    }),
};

const options = { planId: "p1", target: { kind: "page" as const }, mode: "create" as const };

function plan(pds = PRICING_PDS): EmitPlan {
  return lowerToEmitPlan(pds, options);
}

/** Ops that create a node (as opposed to deletes or reorders). */
const creates = (p: EmitPlan): EmitOp[] => p.ops.filter((op) => op.node !== undefined);

describe("lowering the demo pricing design", () => {
  it("produces a plan carrying the id and target it was given", () => {
    const p = plan();
    expect(p.planId).toBe("p1");
    expect(p.target).toEqual({ kind: "page" });
    expect(p.mode).toBe("create");
  });

  it("emits an op for every node in the document", () => {
    expect(creates(plan())).toHaveLength(Object.keys(PRICING_PDS.nodes).length);
  });

  it("gives every op a key that maps back to a PDS handle", () => {
    // `op.key` is what the executor stamps on the node and what the result maps
    // back to an `el` — a key with no counterpart makes the round trip fail.
    for (const op of creates(plan())) {
      expect(PRICING_PDS.nodes[op.key], op.key).toBeDefined();
    }
  });

  it("names a parent that the plan also creates", () => {
    const p = plan();
    const keys = new Set(creates(p).map((op) => op.key));
    for (const op of creates(p)) {
      if (op.parent) expect(keys.has(op.parent), `${op.key} → ${op.parent}`).toBe(true);
    }
  });

  it("creates a parent before any child that names it", () => {
    // The executor replays ops in order and appends children as it goes, so a
    // child ahead of its parent has nothing to attach to.
    const seen = new Set<string>();
    for (const op of creates(plan())) {
      if (op.parent) expect(seen.has(op.parent), `${op.key} before ${op.parent}`).toBe(true);
      seen.add(op.key);
    }
  });

  it("has exactly one root op", () => {
    expect(creates(plan()).filter((op) => !op.parent)).toHaveLength(1);
  });

  it("declares every font its text nodes need", () => {
    // Figma rejects a `characters` assignment unless the face is already
    // loaded, so this list is the executor's preload and it has to be complete.
    const p = plan();
    expect(p.fonts.length).toBeGreaterThan(0);
    const declared = new Set(p.fonts.map((f) => `${f.family} ${f.style}`));
    for (const op of creates(p)) {
      const font = op.node?.text?.font;
      if (font) expect(declared.has(`${font.family} ${font.style}`), op.key).toBe(true);
    }
  });

  it("dedupes the font list", () => {
    const p = plan();
    const keys = p.fonts.map((f) => `${f.family} ${f.style}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("carries text content and its resolved size", () => {
    const title = creates(plan()).find((op) => op.key === "title");
    expect(title?.node?.text?.characters).toBe("Simple, honest pricing");
    expect(title?.node?.text?.fontSize).toBe(48);
  });

  it("resolves token refs to concrete values — the executor cannot look them up", () => {
    const p = plan();
    const serialized = JSON.stringify(p);
    expect(serialized).not.toMatch(/"\$c\d/);
    expect(serialized).not.toMatch(/"\$t\d/);
    expect(serialized).not.toMatch(/"\$r\d/);
  });

  it("lowers fills to Figma paints in 0..1 float channels", () => {
    const card = creates(plan()).find((op) => op.key === "card-starter");
    const paint = card?.node?.fills?.[0];
    expect(paint?.type).toBe("SOLID");
    if (paint?.type !== "SOLID") throw new Error("expected a solid paint");
    for (const channel of [paint.color.r, paint.color.g, paint.color.b]) {
      expect(channel).toBeGreaterThanOrEqual(0);
      expect(channel).toBeLessThanOrEqual(1);
    }
  });

  it("keeps the two-layer fill stack on the highlighted card", () => {
    expect(creates(plan()).find((op) => op.key === "card-pro")?.node?.fills).toHaveLength(2);
  });

  it("resolves the pill radius to a number, since Figma has no \"full\"", () => {
    const cta = creates(plan()).find((op) => op.key === "starter-cta");
    expect(typeof cta?.node?.cornerRadius).toBe("number");
    expect(cta?.node?.cornerRadius).toBeGreaterThan(20);
  });

  it("lowers auto-layout onto the primary/counter axis pair", () => {
    const plans = creates(plan()).find((op) => op.key === "plans");
    expect(plans?.node?.layout?.mode).toBe("HORIZONTAL");
    expect(plans?.node?.layout?.gap).toBe(24);
  });

  it("carries the shadow through as an effect", () => {
    const effects = creates(plan()).find((op) => op.key === "card-starter")?.node?.effects;
    expect(effects?.length).toBeGreaterThan(0);
    expect(effects?.[0]?.type).toBe("DROP_SHADOW");
  });

  it("is deterministic", () => {
    expect(plan()).toEqual(plan());
  });

  it("produces a plan that survives a JSON round trip", () => {
    // It crosses the WebSocket, so anything not JSON-representable is a bug
    // that only shows up in a real session.
    const p = plan();
    expect(JSON.parse(JSON.stringify(p))).toEqual(p);
  });
});

describe("lowering a compiled (write-side) document", () => {
  it("lowers the landing example the same way it lowers an extracted design", async () => {
    const { doc } = await compile(landingDoc, { assets });
    const p = lowerToEmitPlan(doc, options);

    expect(creates(p).length).toBe(Object.keys(doc.nodes).length);
    const keys = new Set(creates(p).map((op) => op.key));
    for (const op of creates(p)) {
      if (op.parent) expect(keys.has(op.parent)).toBe(true);
    }
  });

  it("omits the manifest when the caller supplied no per-asset info", async () => {
    // The lowerer knows which refs a design uses, but only the asset engine
    // knows their extension and bytes — so with no info there is nothing
    // shippable, and an empty manifest would be a lie about what was staged.
    const { doc } = await compile(landingDoc, { assets });
    expect(lowerToEmitPlan(doc, options).assets).toBeUndefined();
  });

  it("ships a manifest entry for every referenced asset the caller described", async () => {
    const { doc } = await compile(landingDoc, { assets });
    const referenced = [
      ...new Set(
        Object.values(doc.nodes)
          .map((n) => n.assetId)
          .filter((id): id is string => !!id),
      ),
    ];
    expect(referenced.length).toBeGreaterThan(0);

    const info = Object.fromEntries(
      referenced.map((ref) => [ref, { ext: "png" as const, kind: "image" as const, w: 800, h: 600 }]),
    );
    const p = lowerToEmitPlan(doc, { ...options, assets: info });

    expect(new Set((p.assets ?? []).map((a) => a.ref))).toEqual(new Set(referenced));
    expect(p.assets?.every((a) => a.ext === "png" && a.w === 800)).toBe(true);
  });

  it("skips a referenced asset the caller could not describe", async () => {
    const { doc } = await compile(landingDoc, { assets });
    const p = lowerToEmitPlan(doc, { ...options, assets: {} });
    expect(p.assets ?? []).toEqual([]);
  });

  it("declares fonts for the generated text too", async () => {
    const { doc } = await compile(landingDoc, { assets });
    expect(lowerToEmitPlan(doc, options).fonts.length).toBeGreaterThan(0);
  });
});

describe("degenerate documents", () => {
  it("lowers a document whose root is missing without throwing", () => {
    const orphaned = { ...PRICING_PDS, root: "gone" };
    expect(() => lowerToEmitPlan(orphaned, options)).not.toThrow();
  });

  it("skips a child reference that points at nothing", () => {
    // Compressed repeat-group siblings are absent from `nodes` on purpose, so
    // this is a normal condition, not a corrupt document.
    const withGhost = {
      ...PRICING_PDS,
      nodes: {
        ...PRICING_PDS.nodes,
        pricing: { ...PRICING_PDS.nodes.pricing!, children: ["header", "ghost"] },
      },
    };
    const p = lowerToEmitPlan(withGhost, options);
    expect(creates(p).some((op) => op.key === "ghost")).toBe(false);
    expect(creates(p).some((op) => op.key === "header")).toBe(true);
  });

  it("terminates on a cycle in the children graph", () => {
    const cyclic = {
      ...PRICING_PDS,
      nodes: {
        ...PRICING_PDS.nodes,
        header: { ...PRICING_PDS.nodes.header!, children: ["pricing"] },
      },
    };
    const p = lowerToEmitPlan(cyclic, options);
    const keys = creates(p).map((op) => op.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("honours the sync mode it is given", () => {
    expect(lowerToEmitPlan(PRICING_PDS, { ...options, mode: "sync" }).mode).toBe("sync");
  });
});
