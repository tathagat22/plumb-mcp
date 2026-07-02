/**
 * `plumb_review` core — blends the STRUCTURE diff (built vs authored, scored by
 * the existing fit engine) with the DESIGN critique (the six-dimension rubric)
 * into one 0–100 review score and a single prioritised fix list.
 *
 * Output shape deliberately mirrors `plumb_fit`'s `FitResponse` (score / done /
 * bar / topFixes / instruction) so the write-direction loop feels identical to
 * the read-direction one: build → review → fix → repeat until `done`.
 *
 * Pure: a deterministic function of a `VerifyResult` + a `RubricResult`. All
 * I/O (re-serialize, screenshot, Studio) lives in the tool that calls this.
 */
import { renderBar, scoreOf } from "../fit";
import type { RubricResult, RubricSeverity } from "./rubric";
import type { DirectorSummary } from "./director";
import type { Delta, VerifyResult } from "../verify";

export * from "./contrast";
export * from "./pdsAdapter";
export * from "./rubric";
export * from "./director";
export * from "./loop";

/**
 * How the two halves combine. Structure and design weigh equally: a
 * pixel-faithful build of a bad design is only half-right, and a beautiful
 * layout that didn't actually emit is the other half-right. Both must be high.
 *
 * When a third, vision axis (the DIRECTOR) is present, the weights shift to
 * 0.4 / 0.3 / 0.3 — see `buildReviewResponse`'s `director` argument. Existing
 * callers that never pass a director keep these two-axis weights untouched.
 */
const STRUCTURE_WEIGHT = 0.5;
const DESIGN_WEIGHT = 0.5;

/** Design is fuzzier than pixel-fit, so the review bar sits below fit's 98. */
export const DEFAULT_REVIEW_ACCEPT = 90;

export interface ReviewDimensionSummary {
  id: string;
  label: string;
  score: number;
  weight: number;
}

export interface ReviewResponse {
  /** Blended 0–100 review score (one decimal). */
  score: number;
  /** Structure half — built-vs-authored fidelity × coverage. */
  structureScore: number;
  /** Design half — the rubric's weighted overall. */
  designScore: number;
  /** True once the blended score clears `accept`, structure has no errors, and
   *  the rubric has no error-severity issues (e.g. failing contrast). */
  done: boolean;
  bar: string;
  iteration?: number;
  matched: number;
  importantMatched: number;
  importantTotal: number;
  /** Matched built nodes carrying a structural error. */
  structureErrors: number;
  structureWarns: number;
  dimensions: ReviewDimensionSummary[];
  /** Highest-leverage changes across both halves (or all three, with a
   *  director present), sorted error-first. */
  topFixes: string[];
  instruction: string;
  /** Vision creative-director's 0–100 gut score, when graded. */
  directorScore?: number;
  /** Vision creative-director's one-paragraph verdict, when graded. */
  directorVerdict?: string;
}

export interface ReviewOptions {
  accept?: number;
  iteration?: number;
  maxFixes?: number;
}

const RANK: Record<RubricSeverity, number> = { error: 0, warn: 1, info: 2 };

function fmtVal(v: string | number | null): string {
  if (v === null) return "—";
  return typeof v === "string" ? `"${v}"` : String(v);
}

function fmtDelta(d: Delta): string {
  const where = d.name ? `${d.el} (${d.name})` : d.el;
  return `[structure] ${where} · ${d.kind}: expected ${fmtVal(d.expected)}, got ${fmtVal(d.actual)}`;
}

/** Blend a structure `VerifyResult` and a design `RubricResult` into a review.
 *  Optionally blend in a third, vision axis (the DIRECTOR) — when present the
 *  weights reweight to structure 0.4 / design 0.3 / vision 0.3; when absent
 *  the existing structure 0.5 / design 0.5 blend is untouched, so every
 *  existing caller keeps its current behaviour verbatim. */
export function buildReviewResponse(
  structure: VerifyResult,
  rubric: RubricResult,
  opts: ReviewOptions = {},
  director?: DirectorSummary,
): ReviewResponse {
  const accept = opts.accept ?? DEFAULT_REVIEW_ACCEPT;
  const maxFixes = opts.maxFixes ?? 8;

  const s = scoreOf(structure);
  const structureScore = s.score;
  const designScore = rubric.overall;
  const directorScore = director?.score;

  const w = director
    ? { s: 0.4, d: 0.3, v: 0.3 }
    : { s: STRUCTURE_WEIGHT, d: DESIGN_WEIGHT, v: 0 };
  const score =
    Math.round((w.s * structureScore + w.d * designScore + w.v * (directorScore ?? 0)) * 10) / 10;

  const rubricHasError = rubric.issues.some((i) => i.severity === "error");
  const directorHasError = (director?.issues ?? []).some((i) => i.severity === "error");
  const done = structure.ok && !rubricHasError && !directorHasError && score >= accept;

  // Merge all fix streams, tagged with severity, and sort error-first.
  const structureFixes = structure.deltas
    .filter((d) => d.severity !== "info" && d.kind !== "missing-in-pds")
    .map((d) => ({ severity: d.severity as RubricSeverity, text: fmtDelta(d) }));
  const designFixes = rubric.issues.map((i) => ({
    severity: i.severity,
    text: `[design/${i.dimension}]${i.el ? ` ${i.el}` : ""} ${i.message} → ${i.fix}`,
  }));
  // Director issues reuse the exact same RubricIssue shape, tagged
  // `[director/<dim>]` so the agent can tell a "looks wrong" (vision) fix
  // from a "measures wrong" (deterministic rubric) fix.
  const directorFixes = (director?.issues ?? []).map((i) => ({
    severity: i.severity,
    text: `[director/${i.dimension}]${i.el ? ` ${i.el}` : ""} ${i.message} → ${i.fix}`,
  }));
  const topFixes = [...structureFixes, ...designFixes, ...directorFixes]
    .sort((a, b) => RANK[a.severity] - RANK[b.severity])
    .slice(0, maxFixes)
    .map((f) => f.text);

  const pct = score.toFixed(1);
  const weakest = rubric.dimensions
    .slice()
    .sort((a, b) => a.score - b.score)[0];
  // Whichever axis is weakest this pass leads the instruction. With a
  // director present, its score competes with structure/design for the lead.
  const directorIsWeakest =
    director !== undefined &&
    directorScore !== undefined &&
    directorScore < structureScore &&
    directorScore < designScore;

  let instruction: string;
  if (done) {
    const axes = director
      ? `structure ${structureScore.toFixed(1)}%, design ${designScore}%, director ${directorScore}%`
      : `structure ${structureScore.toFixed(1)}%, design ${designScore}%`;
    instruction =
      `Ship-ready — ${pct}% (${axes}). ` +
      `Built every key node cleanly and the design holds up. Stop.`;
  } else if (structure.matched === 0) {
    instruction =
      `Nothing to review yet (structure 0%). Emit the design, pass EmitResult.ids so the built ` +
      `nodes can be joined to what you authored, then call plumb_review again.`;
  } else {
    const it = opts.iteration ? `Iteration ${opts.iteration}: ` : "";
    const lead = !structure.ok
      ? `fix the ${s.errors} structural error(s)`
      : directorHasError
        ? `resolve the director's failing issue(s) — the render looks broken`
        : rubricHasError
          ? `resolve the failing ${weakest ? weakest.label.toLowerCase() : "design"} issue(s)`
          : directorIsWeakest
            ? `address the director's critique (${directorScore}%)${director?.verdict ? `: "${director.verdict}"` : ""}`
            : `lift ${weakest ? weakest.label.toLowerCase() : "the weakest dimension"} (${weakest ? weakest.score : "?"}%)`;
    instruction =
      `${it}${pct}% — ${lead} from topFixes, re-apply (mode:"sync" keeps plumbKey), and review again.`;
  }

  return {
    score,
    structureScore,
    designScore,
    done,
    bar: renderBar(score),
    iteration: opts.iteration,
    matched: structure.matched,
    importantMatched: s.importantMatched,
    importantTotal: s.importantTotal,
    structureErrors: s.errors,
    structureWarns: s.warns,
    dimensions: rubric.dimensions.map((d) => ({
      id: d.id,
      label: d.label,
      score: d.score,
      weight: d.weight,
    })),
    topFixes,
    instruction,
    ...(director ? { directorScore, directorVerdict: director.verdict ?? "" } : {}),
  };
}
