import { describe, expect, it } from "vitest";
import { buildReviewResponse } from "./index";
import type { DirectorSummary } from "./director";
import type { RubricResult } from "./rubric";
import type { VerifyResult } from "../verify";

/** A perfect structural match: matched, no deltas, nothing unmatched. */
function perfectStructure(): VerifyResult {
  return { matched: 5, rendered: 5, unmatched: 0, ok: true, deltas: [] };
}

/** A perfect rubric: full marks, no issues. */
function perfectRubric(): RubricResult {
  return {
    overall: 100,
    dimensions: [
      { id: "hierarchy", label: "Visual hierarchy", score: 100, weight: 0.2, issues: [] },
    ],
    issues: [],
  };
}

describe("buildReviewResponse", () => {
  it("keeps the existing 50/50 structure/design blend when no director is passed", () => {
    const structure: VerifyResult = { ...perfectStructure() };
    const rubric: RubricResult = {
      ...perfectRubric(),
      overall: 60,
      dimensions: [{ id: "polish", label: "Professional polish", score: 60, weight: 0.1, issues: [] }],
    };
    const review = buildReviewResponse(structure, rubric);
    // 0.5*100 + 0.5*60 = 80
    expect(review.score).toBe(80);
    expect(review.directorScore).toBeUndefined();
    expect(review.directorVerdict).toBeUndefined();
  });

  it("reweights to structure 0.4 / design 0.3 / director 0.3 when a director summary is present", () => {
    const structure = perfectStructure(); // structureScore 100
    const rubric = perfectRubric(); // designScore 100
    const director: DirectorSummary = { score: 50, issues: [] };
    const review = buildReviewResponse(structure, rubric, {}, director);
    // 0.4*100 + 0.3*100 + 0.3*50 = 40 + 30 + 15 = 85
    expect(review.score).toBe(85);
    expect(review.directorScore).toBe(50);
  });

  it("blocks done when the director reports an error-severity issue, even at score >= accept", () => {
    const structure = perfectStructure();
    const rubric = perfectRubric();
    const director: DirectorSummary = {
      score: 100,
      verdict: "Looks broken on screen despite measuring fine.",
      issues: [
        {
          dimension: "polish",
          severity: "error",
          message: "Logo rendered as a grey box, not the real mark.",
          fix: "Use the exported asset, not a placeholder.",
        },
      ],
    };
    const review = buildReviewResponse(structure, rubric, { accept: 90 }, director);
    // All three axes are perfect, so the blended score clears `accept`...
    expect(review.score).toBe(100);
    // ...but the director's error-severity issue must still block `done`.
    expect(review.done).toBe(false);
    // And it should show up, tagged, in topFixes.
    expect(review.topFixes.some((f) => f.startsWith("[director/polish]"))).toBe(true);
  });

  it("still reaches done with a clean director verdict at/above accept", () => {
    const structure = perfectStructure();
    const rubric = perfectRubric();
    const director: DirectorSummary = { score: 95, verdict: "Crisp and considered.", issues: [] };
    const review = buildReviewResponse(structure, rubric, { accept: 90 }, director);
    expect(review.done).toBe(true);
    expect(review.directorVerdict).toBe("Crisp and considered.");
  });
});
