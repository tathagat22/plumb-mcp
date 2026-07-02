/**
 * Pure stop-gate/cap helper for the `plumb_review` refine loop.
 *
 * `buildReviewResponse.done` already IS the gate — this module doesn't add
 * new grading logic. It exists so the "should I stop, and why" decision is a
 * single, unit-testable, no-I/O function the agent (or a future Studio
 * "auto-run" button) can call without re-deriving the cap/iteration reasoning
 * inline. Pure JSON in, JSON out — no I/O.
 */
import type { ReviewResponse } from "./index";

export interface NextStepResult {
  /** True when the loop should stop — either ship-ready or the cap was hit. */
  stop: boolean;
  /** Why it stopped (or didn't). */
  reason: string;
  /** What the agent should do next. */
  action: string;
}

/**
 * Decide whether the refine loop should stop after this `plumb_review` call.
 *
 * @param review    The just-returned `ReviewResponse`.
 * @param iteration Which pass this was (1-based).
 * @param cap       Max iterations to allow before giving up regardless of
 *                  score (bounds cost on a design that won't converge).
 */
export function nextStep(review: ReviewResponse, iteration: number, cap: number): NextStepResult {
  if (review.done) {
    return {
      stop: true,
      reason: `Ship-ready at ${review.score}% on iteration ${iteration}.`,
      action: "Stop — no further changes needed.",
    };
  }
  if (iteration >= cap) {
    return {
      stop: true,
      reason: `Hit the iteration cap (${cap}) at ${review.score}% without clearing the acceptance bar.`,
      action:
        "Stop and report the remaining topFixes — further passes are unlikely to converge without human input.",
    };
  }
  return {
    stop: false,
    reason: `Not yet ship-ready (${review.score}%), iteration ${iteration} of ${cap}.`,
    action: review.instruction,
  };
}
