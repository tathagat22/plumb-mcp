import { describe, expect, it } from "vitest";
import type { AssetSpec } from "../../dsl/schema";
import { listAssetProviders, registerAssetProvider } from "./builtins";
import type { AssetCandidate, AssetProvider } from "./contracts";
import { resolveAsset, searchAssets } from "../search";

/**
 * The asset engine's contract is unusual and worth pinning precisely: it must
 * NEVER throw and never leave the caller without something to render. A photo
 * provider being down, rate-limited, or missing its API key costs you the
 * photo you wanted — not the page.
 *
 * These specs drive that through the real orchestration by registering fake
 * providers. The keyless built-ins stay registered alongside and may attempt a
 * real request, so every assertion is scoped to the fakes or to the shape of
 * the result — never to a count that a reachable (or unreachable) network
 * would change. Short timeouts keep the offline case fast.
 */

/** A provider that returns exactly the candidates it was constructed with. */
function fakeProvider(
  id: string,
  candidates: Partial<AssetCandidate>[],
  over: Partial<AssetProvider> = {},
): AssetProvider {
  return {
    id,
    kinds: ["photo"],
    keyless: true,
    search: () =>
      Promise.resolve(
        candidates.map((c, i) => ({
          provider: id,
          id: `${id}-${i}`,
          kind: "photo" as const,
          fetch: () =>
            Promise.resolve({
              bytes: new Uint8Array([1, 2, 3]),
              ext: "png" as const,
              mime: "image/png",
            }),
          ...c,
        })),
      ),
    ...over,
  };
}

const spec = (over: Partial<AssetSpec> = {}): AssetSpec => ({
  kind: "photo",
  query: "quiet office desk",
  ...over,
});

describe("the provider registry", () => {
  it("accepts a registration and lists it back", () => {
    registerAssetProvider(fakeProvider("test-registry", []));
    expect(listAssetProviders().map((p) => p.id)).toContain("test-registry");
  });

  it("replaces a provider registered under the same id", () => {
    registerAssetProvider(fakeProvider("test-dupe", []));
    registerAssetProvider(fakeProvider("test-dupe", []));
    expect(listAssetProviders().filter((p) => p.id === "test-dupe")).toHaveLength(1);
  });
});

describe("searchAssets", () => {
  it("returns candidates from a registered provider", async () => {
    registerAssetProvider(
      fakeProvider("test-hit", [{ title: "quiet office desk", w: 1600, h: 900 }]),
    );
    const result = await searchAssets(spec(), { env: {} });
    expect(result.providersRun).toContain("test-hit");
    expect(result.candidates.some((c) => c.provider === "test-hit")).toBe(true);
  });

  it("ranks a well-matching candidate above a poor one", async () => {
    registerAssetProvider(
      fakeProvider("test-rank", [
        { id: "test-rank-miss", title: "a photograph of a cat" },
        { id: "test-rank-hit", title: "quiet office desk" },
      ]),
    );
    const { candidates } = await searchAssets(spec(), { env: {} });
    const mine = candidates.filter((c) => c.provider === "test-rank");
    expect(mine[0]?.id).toBe("test-rank-hit");
  });

  it("drops a keyed provider whose env key is absent, and says why", async () => {
    // A missing key is never an error — it just means fewer candidates.
    registerAssetProvider(
      fakeProvider("test-keyed", [{ title: "x" }], { keyless: false, envKey: "TEST_ONLY_KEY" }),
    );
    const result = await searchAssets(spec(), { env: {} });
    expect(result.providersRun).not.toContain("test-keyed");
    expect(result.providersDropped.map((d) => d.id)).toContain("test-keyed");
  });

  it("runs that provider once its key is present", async () => {
    registerAssetProvider(
      fakeProvider("test-keyed-2", [{ title: "x" }], { keyless: false, envKey: "TEST_ONLY_KEY" }),
    );
    const result = await searchAssets(spec(), { env: { TEST_ONLY_KEY: "abc" } });
    expect(result.providersRun).toContain("test-keyed-2");
  });

  it("skips a provider that does not serve the requested kind", async () => {
    registerAssetProvider(fakeProvider("test-kind", [{ title: "x" }], { kinds: ["font"] }));
    const result = await searchAssets(spec({ kind: "photo" }), { env: {} });
    expect(result.providersRun).not.toContain("test-kind");
  });

  it("survives a provider that throws, and records it as dropped", async () => {
    // The whole engine's promise: one broken provider degrades the result set,
    // it does not fail the call.
    registerAssetProvider(
      fakeProvider("test-throws", [], { search: () => Promise.reject(new Error("boom")) }),
    );
    registerAssetProvider(fakeProvider("test-survives", [{ title: "quiet office desk" }]));

    const result = await searchAssets(spec(), { env: {} });
    expect(result.providersDropped.map((d) => d.id)).toContain("test-throws");
    expect(result.candidates.some((c) => c.provider === "test-survives")).toBe(true);
  });

  it("survives a provider that returns a non-array", async () => {
    registerAssetProvider(
      fakeProvider("test-garbage", [], {
        search: () => Promise.resolve("not-an-array" as unknown as AssetCandidate[]),
      }),
    );
    await expect(searchAssets(spec(), { env: {} })).resolves.toBeTruthy();
  });

  it("honours the result limit", async () => {
    registerAssetProvider(
      fakeProvider(
        "test-many",
        Array.from({ length: 30 }, (_, i) => ({ title: `quiet office desk ${i}` })),
      ),
    );
    const result = await searchAssets(spec(), { env: {}, limit: 5 });
    expect(result.candidates.length).toBeLessThanOrEqual(5);
  });

  it("returns a well-formed result even when nothing matches", async () => {
    const result = await searchAssets(spec({ query: "zzzz-nothing-matches-zzzz" }), {
      env: {},
      timeoutMs: 50,
    });
    expect(Array.isArray(result.candidates)).toBe(true);
    expect(Array.isArray(result.providersRun)).toBe(true);
    expect(Array.isArray(result.providersDropped)).toBe(true);
  });

  it("names the single icon pack the ranking locked onto", async () => {
    registerAssetProvider(
      fakeProvider(
        "iconify",
        [
          { id: "lucide:lock", kind: "icon", title: "lock" },
          { id: "lucide:user", kind: "icon", title: "user" },
        ],
        { kinds: ["icon"] },
      ),
    );
    const result = await searchAssets(spec({ kind: "icon", query: "lock" }), { env: {} });
    if (result.candidates.length > 0) expect(typeof result.iconPack === "string").toBe(true);
  });
});

describe("resolveAsset", () => {
  it("fetches the winning candidate's bytes", async () => {
    registerAssetProvider(
      fakeProvider("test-resolve", [{ title: "quiet office desk", w: 1600, h: 900 }]),
    );
    const asset = await resolveAsset(spec(), { env: {} });
    expect(asset.bytes?.length).toBeGreaterThan(0);
    expect(asset.ext).toBeTruthy();
  });

  it("falls through to the next candidate when the first fetch fails", async () => {
    registerAssetProvider(
      fakeProvider("test-fallthrough", [
        {
          id: "test-fallthrough-broken",
          title: "quiet office desk",
          fetch: () => Promise.reject(new Error("404")),
        },
        {
          id: "test-fallthrough-good",
          title: "quiet office desk",
          fetch: () =>
            Promise.resolve({ bytes: new Uint8Array([9]), ext: "png" as const, mime: "image/png" }),
        },
      ]),
    );
    const asset = await resolveAsset(spec(), { env: {} });
    expect(asset.bytes).toBeTruthy();
  });

  it("degrades to a deterministic placeholder rather than throwing", async () => {
    // The contract the DSL compiler depends on: resolve always returns
    // something, so a page never loses its layout to a provider outage.
    const asset = await resolveAsset(spec({ query: "zzzz-nothing-matches-zzzz" }), {
      env: {},
      timeoutMs: 50,
    });
    expect(asset).toBeTruthy();
    expect(asset.kind).toBeTruthy();
  });

  it("never rejects, whatever the providers do", async () => {
    registerAssetProvider(
      fakeProvider("test-all-broken", [], { search: () => Promise.reject(new Error("down")) }),
    );
    await expect(resolveAsset(spec(), { env: {}, timeoutMs: 50 })).resolves.toBeTruthy();
  });
});
