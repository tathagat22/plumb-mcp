import { describe, expect, it } from "vitest";
import type { AssetResolver, AssetSpec, DesignDoc, ResolvedAsset } from "./schema";
import { compile } from "./compile";
import { landingDoc } from "./examples/landing";
import { featureCardDoc } from "./examples/feature-card";

/**
 * The write direction's end-to-end test: a validated `DesignDoc` all the way
 * down to a `PdsDocument`.
 *
 * The claim this pins is the symmetry the whole architecture rests on — a
 * design Plumb *generates* must be shape-identical to one it *reads* from
 * Figma, because every consumer downstream (verify, emit, describe, the
 * rubric) is written against exactly one shape. A compiler that produced a
 * nearly-PDS would break all of them at once, and would do it silently.
 *
 * Uses the two worked examples the DSL ships rather than a bespoke fixture,
 * so these specs fail if the examples in the docs stop compiling.
 */

/** Resolves every request, so asset handling is exercised on its success path. */
const resolvingAssets: AssetResolver = {
  resolve: (spec: AssetSpec): Promise<ResolvedAsset> =>
    Promise.resolve(
      spec.kind === "icon"
        ? { kind: "icon", vectorPath: "M0 0 L10 10", assetId: `icon-${spec.query}`, w: 24, h: 24 }
        : {
            kind: spec.kind ?? "photo",
            assetId: `asset-${spec.query}`,
            url: "https://x/y.png",
            w: 800,
            h: 600,
          },
    ),
};

/** Resolves nothing, which the compiler must survive with warnings. */
const failingAssets: AssetResolver = {
  resolve: () => Promise.reject(new Error("provider down")),
};

/** Walk every el reachable from the root. */
function reachable(doc: Awaited<ReturnType<typeof compile>>["doc"]): string[] {
  const seen = new Set<string>();
  const queue = [doc.root];
  while (queue.length) {
    const el = queue.shift()!;
    if (seen.has(el)) continue;
    seen.add(el);
    for (const child of doc.nodes[el]?.children ?? []) queue.push(child);
  }
  return [...seen];
}

describe("compiling the landing example", () => {
  it("produces a well-formed PdsDocument", async () => {
    const { doc } = await compile(landingDoc, { assets: resolvingAssets });
    expect(doc.schemaVersion).toBeTruthy();
    expect(doc.root).toBeTruthy();
    expect(doc.nodes[doc.root]).toBeDefined();
    expect(Object.keys(doc.nodes).length).toBeGreaterThan(10);
  });

  it("gives every node the identity fields a consumer indexes on", async () => {
    const { doc } = await compile(landingDoc, { assets: resolvingAssets });
    for (const [el, node] of Object.entries(doc.nodes)) {
      expect(node.el, el).toBe(el);
      expect(typeof node.id, el).toBe("string");
      expect(typeof node.type, el).toBe("string");
      expect(typeof node.box.w, el).toBe("number");
      expect(typeof node.box.h, el).toBe("number");
    }
  });

  it("resolves every child reference — no dangling els", async () => {
    // A child pointing at nothing is the failure mode that makes a renderer
    // silently drop a whole subtree.
    const { doc } = await compile(landingDoc, { assets: resolvingAssets });
    for (const node of Object.values(doc.nodes)) {
      for (const child of node.children ?? []) {
        expect(doc.nodes[child], `${node.el} → ${child}`).toBeDefined();
      }
    }
  });

  it("reaches every node from the root", async () => {
    const { doc } = await compile(landingDoc, { assets: resolvingAssets });
    expect(reachable(doc).sort()).toEqual(Object.keys(doc.nodes).sort());
  });

  it("interns the brand into a token table the nodes actually refer into", async () => {
    const { doc } = await compile(landingDoc, { assets: resolvingAssets });
    expect(Object.keys(doc.tokens.color).length).toBeGreaterThan(0);
    expect(Object.keys(doc.tokens.text).length).toBeGreaterThan(0);

    for (const node of Object.values(doc.nodes)) {
      if (node.fill?.startsWith("$c")) expect(doc.tokens.color[node.fill]).toBeDefined();
      if (node.text?.startsWith("$t")) expect(doc.tokens.text[node.text]).toBeDefined();
    }
  });

  it("emits text nodes carrying their content", async () => {
    const { doc } = await compile(landingDoc, { assets: resolvingAssets });
    const texts = Object.values(doc.nodes).filter((n) => n.type === "text");
    expect(texts.length).toBeGreaterThan(3);
    expect(texts.every((t) => t.chars !== undefined)).toBe(true);
  });

  it("reports the assets the design needs", async () => {
    const { assetRequests } = await compile(landingDoc, { assets: resolvingAssets });
    expect(assetRequests.length).toBeGreaterThan(0);
    for (const spec of assetRequests) {
      expect(typeof spec.query).toBe("string");
      expect(typeof spec.kind).toBe("string");
    }
  });

  it("dedupes the asset requests it batches", async () => {
    const { assetRequests } = await compile(landingDoc, { assets: resolvingAssets });
    const keys = assetRequests.map((s) => `${s.kind}:${s.query}:${s.style?.join(",") ?? ""}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("fills in the meta a consumer budgets against", async () => {
    const { doc } = await compile(landingDoc, { assets: resolvingAssets });
    expect(doc.meta.nodeCount).toBe(Object.keys(doc.nodes).length);
    expect(doc.meta.estTokens).toBeGreaterThan(0);
  });

  it("is deterministic — the same input compiles to the same document", async () => {
    // Handles are minted during the walk, so any ordering instability shows up
    // as different `el`s between two runs of the same document.
    const a = await compile(landingDoc, { assets: resolvingAssets });
    const b = await compile(landingDoc, { assets: resolvingAssets });
    expect(a.doc).toEqual(b.doc);
  });

  it("mints unique handles", async () => {
    const { doc } = await compile(landingDoc, { assets: resolvingAssets });
    const els = Object.values(doc.nodes).map((n) => n.el);
    expect(new Set(els).size).toBe(els.length);
  });

  it("compiles cleanly — no warnings when every asset resolves", async () => {
    const { warnings } = await compile(landingDoc, { assets: resolvingAssets });
    expect(warnings).toEqual([]);
  });
});

describe("compiling the feature-card example", () => {
  it("produces a document and a component sidecar", async () => {
    const { doc, components } = await compile(featureCardDoc, { assets: resolvingAssets });
    expect(Object.keys(doc.nodes).length).toBeGreaterThan(0);
    // The example is built around a reusable component, so the sidecar is the
    // point of it.
    expect(Object.keys(components).length).toBeGreaterThan(0);
    for (const entry of Object.values(components)) {
      expect(typeof entry.id).toBe("string");
      expect(typeof entry.el).toBe("string");
      expect(Array.isArray(entry.props)).toBe(true);
    }
  });

  it("still resolves every child reference", async () => {
    const { doc } = await compile(featureCardDoc, { assets: resolvingAssets });
    for (const node of Object.values(doc.nodes)) {
      for (const child of node.children ?? []) {
        expect(doc.nodes[child], `${node.el} → ${child}`).toBeDefined();
      }
    }
  });
});

describe("degradation", () => {
  it("still produces a document when every asset fails to resolve", async () => {
    // The contract is that a provider outage costs you imagery, not the page.
    const { doc, warnings } = await compile(landingDoc, { assets: failingAssets });
    expect(Object.keys(doc.nodes).length).toBeGreaterThan(10);
    expect(warnings.length).toBeGreaterThan(0);
  });

  it("keeps the layout intact when imagery is missing", async () => {
    const resolved = await compile(landingDoc, { assets: resolvingAssets });
    const degraded = await compile(landingDoc, { assets: failingAssets });
    // Same structure, just without the asset ids.
    expect(Object.keys(degraded.doc.nodes).length).toBe(Object.keys(resolved.doc.nodes).length);
  });

  it("compiles a minimal single-section document", async () => {
    const minimal: DesignDoc = {
      version: "1",
      brand: {
        colors: { bg: "#ffffff", text: "#0f172a", primary: "#6366f1" },
        type: { h1: { size: 48, weight: 700 }, body: { size: 16 } },
      },
      pages: [{ name: "Home", sections: [{ role: "hero", headline: "Hello" }] }],
    };
    const { doc } = await compile(minimal, { assets: resolvingAssets });
    expect(doc.nodes[doc.root]).toBeDefined();
    const texts = Object.values(doc.nodes).filter((n) => n.chars === "Hello");
    expect(texts).toHaveLength(1);
  });

  it("compiles a page with no sections at all", async () => {
    const empty: DesignDoc = {
      version: "1",
      brand: {
        colors: { bg: "#ffffff", text: "#0f172a", primary: "#6366f1" },
        type: { body: { size: 16 } },
      },
      pages: [{ name: "Blank", sections: [] }],
    };
    const { doc } = await compile(empty, { assets: resolvingAssets });
    expect(doc.nodes[doc.root]).toBeDefined();
  });

  it("lets a page's own width win over the context default", async () => {
    // landingDoc declares width: 1440. The context width is the fallback for
    // pages that don't, not an override — a document that specifies its canvas
    // means it.
    const forced = await compile(landingDoc, { assets: resolvingAssets, page: { width: 1920 } });
    expect(forced.doc.nodes[forced.doc.root]!.box.w).toBe(1440);
  });

  it("uses the context width for a page that declares none", async () => {
    const doc: DesignDoc = {
      version: "1",
      brand: {
        colors: { bg: "#ffffff", text: "#0f172a", primary: "#6366f1" },
        type: { body: { size: 16 } },
      },
      pages: [{ name: "Home", sections: [{ role: "hero", headline: "Hi" }] }],
    };
    const wide = await compile(doc, { assets: resolvingAssets, page: { width: 1920 } });
    expect(wide.doc.nodes[wide.doc.root]!.box.w).toBe(1920);
  });

  it("falls back to 1440 when neither the page nor the context says", async () => {
    const doc: DesignDoc = {
      version: "1",
      brand: {
        colors: { bg: "#ffffff", text: "#0f172a", primary: "#6366f1" },
        type: { body: { size: 16 } },
      },
      pages: [{ name: "Home", sections: [{ role: "hero", headline: "Hi" }] }],
    };
    const { doc: pds } = await compile(doc, { assets: resolvingAssets });
    expect(pds.nodes[pds.root]!.box.w).toBe(1440);
  });
});
