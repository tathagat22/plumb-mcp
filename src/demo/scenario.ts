/**
 * The offline demo's engine: run the design → build → verify loop over the
 * bundled fixture and score both halves of the claim.
 *
 * Round by round we hand the verify engine a build with a known set of faults
 * in it, then check two things the marketing copy usually leaves vague:
 *
 *   recall    — did it find every fault that was actually injected?
 *   precision — did it stay quiet about the ~30 nodes that were untouched?
 *
 * Both are computed here rather than asserted in prose, so `npm run demo` and
 * the CI spec are reading the same numbers.
 */
import { buildFitResponse, type FitResponse } from "../fit";
import { verifyAgainst, type Delta, type VerifyResult } from "../verify";
import { PRICING_PDS } from "./fixture";
import { FAULTS, applyFaults, type Fault } from "./faults";
import { renderReference } from "./render";

/** Everything reported for one fault after a round. */
export interface FaultOutcome {
  fault: Fault;
  /** True when every `<el>:<kind>` the fault promised actually showed up. */
  detected: boolean;
  /** The promises that did NOT show up — empty when `detected`. */
  missed: string[];
  /** The deltas the engine attributed to this fault's elements. */
  deltas: Delta[];
}

export interface Round {
  /** 1-based round number. */
  index: number;
  /** What the agent did before this round. */
  action: string;
  /** Fault ids still present in the build. */
  remaining: string[];
  fit: FitResponse;
  verify: VerifyResult;
  outcomes: FaultOutcome[];
  /** Injected faults the engine found. */
  detected: number;
  /** Injected faults the engine missed. */
  missed: number;
  /**
   * Deltas on elements no fault touched — the engine inventing problems in a
   * part of the build that is byte-for-byte correct.
   */
  falsePositives: Delta[];
}

/** `<el>:<kind>` keys the engine actually produced for a round. */
function observedKeys(result: VerifyResult): Set<string> {
  const keys = new Set<string>();
  for (const d of result.deltas) keys.add(`${d.el}:${d.kind}`);
  for (const el of result.coverage?.untagged ?? []) keys.add(`${el}:coverage`);
  return keys;
}

/** Every element any active fault touches — used to isolate false positives. */
function faultedEls(active: Fault[]): Set<string> {
  const els = new Set<string>();
  for (const fault of active) {
    for (const key of fault.expect) {
      const el = key.slice(0, key.lastIndexOf(":"));
      if (el) els.add(el);
    }
  }
  return els;
}

/** Score one build of the fixture against the design. */
export function runRound(index: number, action: string, remaining: string[]): Round {
  const perfect = renderReference(PRICING_PDS);
  const built = applyFaults(perfect, remaining);
  const verify = verifyAgainst(PRICING_PDS, built);
  const fit = buildFitResponse(verify, { iteration: index });

  const observed = observedKeys(verify);
  const active = FAULTS.filter((f) => remaining.includes(f.id));
  const outcomes: FaultOutcome[] = active.map((fault) => {
    const missed = fault.expect.filter((key) => !observed.has(key));
    return {
      fault,
      detected: missed.length === 0,
      // Attribute a delta to a fault only when it is one the fault promised —
      // several faults can land on the same element (the Pro card carries
      // three), and showing each one everybody else's deltas would misreport
      // what the engine actually tied to what.
      deltas: verify.deltas.filter((d) => fault.expect.includes(`${d.el}:${d.kind}`)),
      missed,
    };
  });

  const touched = faultedEls(active);
  const falsePositives = verify.deltas.filter(
    // `info` is advisory by construction (placeholder copy an agent is meant to
    // replace) and never dents the score, so it isn't a false positive.
    (d) => !touched.has(d.el) && d.severity !== "info",
  );

  return {
    index,
    action,
    remaining,
    fit,
    verify,
    outcomes,
    detected: outcomes.filter((o) => o.detected).length,
    missed: outcomes.filter((o) => !o.detected).length,
    falsePositives,
  };
}

/**
 * The scripted repair sequence: ship a first pass with every fault, fix the
 * ten that read as errors, then clear the three cosmetic ones. Mirrors how the
 * fit loop is meant to be driven — highest severity first, re-score each pass.
 */
export function runScenario(): Round[] {
  const all = FAULTS.map((f) => f.id);
  const warnsOnly = FAULTS.filter((f) => f.severity === "warn").map((f) => f.id);

  return [
    runRound(1, "First pass — built straight from the spec, no verification", all),
    runRound(2, "Fixed every error-severity delta the loop reported", warnsOnly),
    runRound(3, "Cleared the remaining warnings", []),
  ];
}
