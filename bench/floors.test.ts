import { describe, expect, it } from "vitest";
import floors from "./floors.json";
import { runCompressionSample, runRoleAccuracy, runStress } from "./run";

/**
 * The CI gate named in docs/ROADMAP-v0.14-design-intelligence.md §9. Runs
 * as part of the normal `npm run test` — no subprocess, no separate CI
 * step to forget to wire up. Heuristic enrichers only: this is a
 * deterministic-output gate, and LLM-assisted enrichers (none exist yet)
 * must never be wired in here — their non-determinism would make this
 * flaky by construction (see the roadmap's §7 kind: "heuristic" |
 * "llm-assisted" split).
 */
describe("benchmark floors — RoleEnricher (heuristic, deterministic)", () => {
  it("meets the committed accuracy floor on the curated fixture set", () => {
    const { overall, perFixture } = runRoleAccuracy();
    const detail = perFixture.map((f) => `${f.name}: F1=${f.score.f1.toFixed(2)}`).join(", ");

    expect(overall.precision, `precision regressed — per-fixture: ${detail}`).toBeGreaterThanOrEqual(
      floors.roleAccuracy.precision,
    );
    expect(overall.recall, `recall regressed — per-fixture: ${detail}`).toBeGreaterThanOrEqual(
      floors.roleAccuracy.recall,
    );
    expect(overall.f1, `f1 regressed — per-fixture: ${detail}`).toBeGreaterThanOrEqual(floors.roleAccuracy.f1);
  });

  it("stays within the latency and memory ceiling on a repeat-heavy synthetic graph", () => {
    const stress = runStress();

    expect(stress.latencyMs).toBeLessThanOrEqual(floors.stress.maxLatencyMs);
    expect(stress.heapDeltaBytes).toBeLessThanOrEqual(floors.stress.maxHeapDeltaBytes);
  });

  it("keeps the token-interning dedup ratio above the committed floor on a repeated-list fixture", () => {
    const compression = runCompressionSample();

    expect(compression.dedupRatio).toBeGreaterThanOrEqual(floors.compression.minTokenDedupRatio);
  });
});
