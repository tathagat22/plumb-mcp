import { describe, expect, it } from "vitest";
import { buildFitResponse } from "../fit";
import { verifyAgainst } from "../verify";
import { FAULTS } from "./faults";
import { PRICING_PDS } from "./fixture";
import { renderReference } from "./render";
import { runRound, runScenario } from "./scenario";
import { summarize } from "./run";

/**
 * The demo is a claim — "we find every mistake and invent none" — so it is
 * gated like one. These specs are the reason `npm run demo` can be trusted:
 * a change that blinds a check fails the recall assertions, and a change that
 * makes a check trigger-happy fails the false-positive assertions.
 */

describe("the reference render is a perfect build", () => {
  const result = verifyAgainst(PRICING_PDS, renderReference(PRICING_PDS));

  it("produces no deltas at all", () => {
    // Any delta here means the renderer and the comparison engine disagree
    // about what "correct" means — which would make every fault measurement
    // below meaningless.
    expect(result.deltas).toEqual([]);
  });

  it("tags every reachable node", () => {
    expect(result.unmatched).toBe(0);
    expect(result.coverage?.untagged).toEqual([]);
    expect(result.coverage?.importantMatched).toBe(result.coverage?.importantTotal);
  });

  it("scores exactly 100 and reports done", () => {
    const fit = buildFitResponse(result);
    expect(fit.score).toBe(100);
    expect(fit.done).toBe(true);
  });
});

describe("every planted fault is caught on its own", () => {
  // One fault at a time, so a fault can't be credited to a delta some other
  // fault produced.
  it.each(FAULTS.map((f) => [f.id, f] as const))("catches %s", (_id, fault) => {
    const round = runRound(1, "isolated fault", [fault.id]);
    const outcome = round.outcomes[0];
    expect(outcome?.missed).toEqual([]);
    expect(outcome?.detected).toBe(true);
  });

  it.each(FAULTS.map((f) => [f.id, f] as const))(
    "stays silent about untouched nodes while %s is present",
    (_id, fault) => {
      const round = runRound(1, "isolated fault", [fault.id]);
      expect(round.falsePositives).toEqual([]);
    },
  );

  it.each(FAULTS.map((f) => [f.id, f] as const))("lowers the score for %s", (_id, fault) => {
    // A fault that doesn't move the number isn't being scored, only listed.
    const round = runRound(1, "isolated fault", [fault.id]);
    expect(round.fit.score).toBeLessThan(100);
  });
});

describe("the scripted repair sequence", () => {
  const rounds = runScenario();

  it("catches all 13 faults in the first pass, with no false positives", () => {
    const first = rounds[0];
    expect(first?.outcomes).toHaveLength(FAULTS.length);
    expect(first?.missed).toBe(0);
    expect(first?.detected).toBe(FAULTS.length);
    expect(first?.falsePositives).toEqual([]);
  });

  it("climbs strictly with each repair round", () => {
    const scores = rounds.map((r) => r.fit.score);
    expect(scores).toHaveLength(3);
    for (let i = 1; i < scores.length; i += 1) {
      expect(scores[i]!).toBeGreaterThan(scores[i - 1]!);
    }
  });

  it("clears every error before it clears the warnings", () => {
    expect(rounds[0]?.fit.errors).toBeGreaterThan(0);
    expect(rounds[1]?.fit.errors).toBe(0);
    expect(rounds[1]?.fit.warns).toBeGreaterThan(0);
  });

  it("converges to a done, pixel-perfect final round", () => {
    const last = rounds.at(-1);
    expect(last?.fit.score).toBe(100);
    expect(last?.fit.done).toBe(true);
    expect(last?.outcomes).toEqual([]);
  });

  it("summarises to a passing scoreboard", () => {
    const summary = summarize(rounds);
    expect(summary).toMatchObject({
      planted: FAULTS.length,
      caught: FAULTS.length,
      missed: 0,
      falsePositives: 0,
      passed: true,
    });
    expect(summary.untouchedNodes).toBeGreaterThan(20);
  });
});

describe("the fault catalogue itself", () => {
  it("has unique ids", () => {
    const ids = FAULTS.map((f) => f.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("only expects deltas on elements the fixture actually defines", () => {
    // `promo-ribbon` is the deliberate exception: a stray element in the build
    // with no counterpart in the design is the whole point of that fault.
    const strays = new Set(["promo-ribbon"]);
    for (const fault of FAULTS) {
      for (const key of fault.expect) {
        const el = key.slice(0, key.lastIndexOf(":"));
        if (strays.has(el)) continue;
        expect(PRICING_PDS.nodes[el], `${fault.id} targets unknown el "${el}"`).toBeDefined();
      }
    }
  });
});
