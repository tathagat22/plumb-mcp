/**
 * Pure scoring functions — no I/O, no fixtures, no enricher knowledge.
 * `bench/run.ts` wires these to real data; `bench/floors.test.ts` asserts
 * the result against a committed floor.
 */
import type { PdsDocument } from "../src/pds";

export interface PrecisionRecallF1 {
  truePositive: number;
  falsePositive: number;
  falseNegative: number;
  precision: number;
  recall: number;
  f1: number;
}

/**
 * Scores a predicted label map against ground truth over exactly the node
 * ids present in `expected` — a string means "must equal this value" (a
 * miss or mismatch is a false negative), `null` means "must not be labeled"
 * (any prediction here is a false positive). Ids absent from `expected`
 * are not scored — most nodes in any real graph rightly have no role.
 */
export function precisionRecallF1(
  predicted: Map<string, string>,
  expected: Record<string, string | null>,
): PrecisionRecallF1 {
  let truePositive = 0;
  let falsePositive = 0;
  let falseNegative = 0;

  for (const [id, want] of Object.entries(expected)) {
    const got = predicted.get(id);
    if (want === null) {
      if (got !== undefined) falsePositive++;
    } else if (got === want) {
      truePositive++;
    } else {
      falseNegative++;
    }
  }

  const precision = truePositive + falsePositive > 0 ? truePositive / (truePositive + falsePositive) : 1;
  const recall = truePositive + falseNegative > 0 ? truePositive / (truePositive + falseNegative) : 1;
  const f1 = precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0;

  return { truePositive, falsePositive, falseNegative, precision, recall, f1 };
}

/**
 * Aggregates several fixtures' predictions into one micro-averaged score —
 * pools true/false positive/negative counts across the whole set before
 * computing precision/recall, so a fixture with more ground-truth nodes
 * carries proportionally more weight than one with a single node.
 */
export function aggregatePrecisionRecallF1(scores: PrecisionRecallF1[]): PrecisionRecallF1 {
  const truePositive = scores.reduce((sum, s) => sum + s.truePositive, 0);
  const falsePositive = scores.reduce((sum, s) => sum + s.falsePositive, 0);
  const falseNegative = scores.reduce((sum, s) => sum + s.falseNegative, 0);
  const precision = truePositive + falsePositive > 0 ? truePositive / (truePositive + falsePositive) : 1;
  const recall = truePositive + falseNegative > 0 ? truePositive / (truePositive + falseNegative) : 1;
  const f1 = precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0;
  return { truePositive, falsePositive, falseNegative, precision, recall, f1 };
}

/**
 * Token-interning dedup ratio — how much of the document's field
 * occurrences were collapsed into a shared `$xN` ref instead of shipped
 * inline. Reuses `tokens.meta.counts`, already computed by the existing
 * interner (`src/normalize/tokens.ts`) as "proof of dedup"; this just turns
 * it into one tracked number. 0 = no repetition in this file (nothing to
 * dedup); closer to 1 = most repeated values were collapsed to a single ref.
 */
export function tokenDedupRatio(doc: PdsDocument): number {
  const counts = doc.tokens.meta?.counts;
  if (!counts) return 0;
  let occurrences = 0;
  let saved = 0;
  for (const count of Object.values(counts)) {
    occurrences += count;
    saved += count - 1; // one occurrence still has to ship the value itself
  }
  return occurrences > 0 ? saved / occurrences : 0;
}
