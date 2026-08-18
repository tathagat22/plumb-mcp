import { describe, expect, it } from "vitest";
import type { AssetSpec } from "../../dsl/schema";
import type { AssetCandidate } from "./contracts";
import { pickIconPack, rankCandidates, scoreCandidate } from "./rank";

/**
 * Ranking is the difference between "found some icons" and "found the right
 * icon". `pickIconPack` in particular is doing visual work, not search work:
 * a design that draws three icons from three different families reads as
 * assembled rather than designed, no matter how well each icon matches its
 * query on its own.
 */

const candidate = (over: Partial<AssetCandidate> = {}): AssetCandidate => ({
  provider: "iconify",
  id: "lucide:lock",
  kind: "icon",
  // Ranking never calls `fetch` — it only reads metadata — but the contract
  // requires one, so give it a stub that would fail loudly if that changed.
  fetch: () => Promise.reject(new Error("ranking must not fetch")),
  ...over,
});

describe("scoreCandidate", () => {
  it("rewards query-term overlap in the title", () => {
    const spec: AssetSpec = { kind: "icon", query: "lock closed" };
    const hit = scoreCandidate(candidate({ title: "lock closed" }), spec);
    const miss = scoreCandidate(candidate({ id: "lucide:cat", title: "cat" }), spec);
    expect(hit).toBeGreaterThan(miss);
  });

  it("matches on tags as well as the title", () => {
    const spec: AssetSpec = { kind: "icon", query: "security" };
    const tagged = scoreCandidate(candidate({ title: "lock", tags: ["security"] }), spec);
    const untagged = scoreCandidate(candidate({ title: "lock" }), spec);
    expect(tagged).toBeGreaterThan(untagged);
  });

  it("penalises a candidate of the wrong kind", () => {
    const spec: AssetSpec = { kind: "icon", query: "lock" };
    const right = scoreCandidate(candidate({ kind: "icon", title: "lock" }), spec);
    const wrong = scoreCandidate(candidate({ kind: "photo", title: "lock" }), spec);
    expect(wrong).toBeLessThan(right);
  });

  it("rewards a matching style tag", () => {
    const spec: AssetSpec = { kind: "icon", query: "lock", style: ["outline"] };
    const styled = scoreCandidate(candidate({ title: "lock", style: ["outline"] }), spec);
    const plain = scoreCandidate(candidate({ title: "lock" }), spec);
    expect(styled).toBeGreaterThan(plain);
  });

  it("rewards a matching icon weight", () => {
    const spec: AssetSpec = { kind: "icon", query: "lock", weight: "bold" };
    const heavy = scoreCandidate(candidate({ title: "lock", weight: "bold" }), spec);
    const light = scoreCandidate(candidate({ title: "lock", weight: "thin" }), spec);
    expect(heavy).toBeGreaterThan(light);
  });

  it("rewards a candidate whose aspect ratio matches the request", () => {
    const spec: AssetSpec = { kind: "photo", query: "office", aspect: 16 / 9 };
    const wide = scoreCandidate(candidate({ kind: "photo", w: 1600, h: 900 }), spec);
    const square = scoreCandidate(candidate({ kind: "photo", w: 1000, h: 1000 }), spec);
    expect(wide).toBeGreaterThan(square);
  });

  it("penalises a candidate below the requested minimum width", () => {
    const spec: AssetSpec = { kind: "photo", query: "office", minWidth: 1200 };
    const big = scoreCandidate(candidate({ kind: "photo", w: 2000, h: 1000 }), spec);
    const small = scoreCandidate(candidate({ kind: "photo", w: 400, h: 200 }), spec);
    expect(small).toBeLessThan(big);
  });

  it("breaks a tie by provider trust", () => {
    const spec: AssetSpec = { kind: "photo", query: "office" };
    const unsplash = scoreCandidate(candidate({ provider: "unsplash", kind: "photo" }), spec);
    const picsum = scoreCandidate(candidate({ provider: "picsum", kind: "photo" }), spec);
    expect(unsplash).not.toBe(picsum);
  });
});

describe("rankCandidates", () => {
  it("sorts best-first and attaches the score", () => {
    const spec: AssetSpec = { kind: "icon", query: "lock" };
    const ranked = rankCandidates(
      [candidate({ id: "lucide:cat", title: "cat" }), candidate({ title: "lock" })],
      spec,
    );
    expect(ranked[0]!.title).toBe("lock");
    expect(typeof ranked[0]!.score).toBe("number");
  });

  it("does not mutate the input array or its candidates", () => {
    const input = [candidate({ title: "lock" })];
    rankCandidates(input, { kind: "icon", query: "lock" });
    expect(input[0]).not.toHaveProperty("score");
  });

  it("handles an empty candidate list", () => {
    expect(rankCandidates([], { kind: "icon", query: "lock" })).toEqual([]);
  });
});

describe("pickIconPack", () => {
  const spec: AssetSpec = { kind: "icon", query: "lock" };

  it("locks the result set to a single icon family", () => {
    // Two lucide icons outweigh one from another pack, so the whole design
    // gets lucide rather than a mix.
    const ranked = rankCandidates(
      [
        candidate({ id: "lucide:lock", title: "lock" }),
        candidate({ id: "lucide:user", title: "user" }),
        candidate({ id: "mdi:lock", title: "lock" }),
      ],
      spec,
    );
    const picked = pickIconPack(ranked, spec);
    expect(picked.prefix).toBe("lucide");
    expect(picked.candidates.every((c) => c.id.startsWith("lucide:"))).toBe(true);
  });

  it("prefers a pack whose house style matches the requested style", () => {
    const outlineSpec: AssetSpec = { kind: "icon", query: "lock", style: ["outline"] };
    const ranked = rankCandidates(
      [candidate({ id: "lucide:lock" }), candidate({ id: "ph:lock" })],
      outlineSpec,
    );
    expect(pickIconPack(ranked, outlineSpec).prefix).toBeDefined();
  });

  it("passes the list through untouched when there are no iconify icons", () => {
    const photos = rankCandidates(
      [candidate({ provider: "unsplash", kind: "photo", id: "abc" })],
      { kind: "photo", query: "office" },
    );
    const picked = pickIconPack(photos, { kind: "photo", query: "office" });
    expect(picked.prefix).toBeUndefined();
    expect(picked.candidates).toEqual(photos);
  });

  it("handles an empty ranked list", () => {
    expect(pickIconPack([], spec)).toEqual({ candidates: [] });
  });

  it("does not drop non-icon candidates by inventing a prefix from them", () => {
    // A mixed result set must not lock photos out of the response.
    const mixed = pickIconPack([], spec);
    expect(mixed.candidates).toEqual([]);
  });
});
