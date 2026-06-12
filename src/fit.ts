/**
 * The self-healing loop's brain.
 *
 * `plumb_verify` answers "is what I built correct?" with a flat list of
 * deltas. The fit loop turns that into a single climbing number — a 0–100
 * convergence score — plus a prioritised, coaching-shaped payload an agent
 * (or the autonomous CLI / playground) can iterate against until the build
 * matches the design pixel-for-pixel.
 *
 * Pure: every export here is a deterministic function of a `VerifyResult`.
 * The render + generate halves of the loop live in the surfaces that call
 * this (the MCP tool, the CLI, the playground) — this module never touches
 * I/O, so the same scoring drives all three.
 */
import type { Delta, VerifyResult } from "./verify";

/**
 * Severity weighting for the fidelity half of the score. An element carrying
 * an error counts as fully wrong; an element with only warnings is mostly
 * right (a warn is "you may have meant this", not "this is broken"). Tuned so
 * fixing any single delta always raises the score — the loop must be
 * monotonic or the climbing counter would stutter.
 */
const ERR_WEIGHT = 1;
const WARN_WEIGHT = 0.35;
/** Each stray rendered element (built, but not in the design) shaves fidelity. */
const EXTRA_STEP = 0.02;
const EXTRA_CAP = 0.15;

/** Default acceptance bar. ≥98 means every key node is built and pixel-clean. */
export const DEFAULT_ACCEPT = 98;

export interface FitScore {
  /** 0–100. 100 = every important node built and within tolerance. */
  score: number;
  /**
   * `importantMatched / importantTotal` — the share of design nodes that
   * carry real visual signal which you actually built. The "breadth" axis.
   */
  coverageFactor: number;
  /** 0–1 correctness of what you built, severity-weighted. The "depth" axis. */
  fidelity: number;
  importantTotal: number;
  importantMatched: number;
  /** Distinct matched elements carrying ≥1 error-severity delta. */
  errors: number;
  /** Distinct matched elements carrying only warn-severity deltas. */
  warns: number;
}

/**
 * Collapse a VerifyResult into a single convergence score.
 *
 * `score = 100 · coverageFactor · fidelity`. The product (not a sum) is
 * deliberate: a screen that's pixel-perfect but only half-built should not
 * read as "50% done and looking great" — it should read low until both axes
 * are high. This is the same "21% coverage with 0 deltas is a lie" guard the
 * verify engine already encodes, expressed as one number.
 */
export function scoreOf(result: VerifyResult): FitScore {
  const cov = result.coverage;
  const importantTotal = cov?.importantTotal ?? cov?.pdsTotal ?? result.matched;
  const importantMatched = cov?.importantMatched ?? result.matched;
  const coverageFactor =
    importantTotal > 0
      ? clamp(importantMatched / importantTotal, 0, 1)
      : result.matched > 0
        ? 1
        : 0;

  // Fidelity over matched nodes, from real deltas. `missing-in-pds` deltas are
  // stray rendered elements, not flaws in a matched node — they're penalised
  // separately via `unmatched`, so excluding them here avoids double-counting.
  const errEls = new Set<string>();
  const warnEls = new Set<string>();
  for (const d of result.deltas) {
    if (d.kind === "missing-in-pds") continue;
    if (d.severity === "error") errEls.add(d.el);
    else if (d.severity === "warn") warnEls.add(d.el);
  }
  for (const el of errEls) warnEls.delete(el); // an erroring el isn't "warn-only"

  let fidelity: number;
  if (result.matched <= 0) {
    fidelity = 0;
  } else {
    const penalised = ERR_WEIGHT * errEls.size + WARN_WEIGHT * warnEls.size;
    fidelity = clamp((result.matched - penalised) / result.matched, 0, 1);
    const extras = Math.max(0, result.unmatched);
    fidelity = clamp(fidelity - Math.min(EXTRA_CAP, extras * EXTRA_STEP), 0, 1);
  }

  const score = Math.round(coverageFactor * fidelity * 1000) / 10; // one decimal
  return {
    score,
    coverageFactor,
    fidelity,
    importantTotal,
    importantMatched,
    errors: errEls.size,
    warns: warnEls.size,
  };
}

export interface FitOptions {
  /** Acceptance threshold; default {@link DEFAULT_ACCEPT}. */
  accept?: number;
  /** Iteration counter for the coaching string (informational). */
  iteration?: number;
  /** How many prioritised fixes to surface. Default 8. */
  maxFixes?: number;
}

export interface FitResponse {
  /** 0–100 convergence score (one decimal). */
  score: number;
  /** True once `score ≥ accept` and there are no error-severity deltas. */
  done: boolean;
  iteration?: number;
  matched: number;
  importantMatched: number;
  importantTotal: number;
  errors: number;
  warns: number;
  /** A 10-cell progress bar (▰/▱) — the climbing counter, ready to print. */
  bar: string;
  /** The highest-leverage changes, already sorted error-first. */
  topFixes: string[];
  /** Natural-language "keep going / you're done" coaching. */
  instruction: string;
}

/**
 * Build the per-iteration coaching payload the loop returns to its caller.
 */
export function buildFitResponse(result: VerifyResult, opts: FitOptions = {}): FitResponse {
  const accept = opts.accept ?? DEFAULT_ACCEPT;
  const maxFixes = opts.maxFixes ?? 8;
  const s = scoreOf(result);
  const done = result.ok && s.score >= accept;

  const topFixes = result.deltas
    .filter((d) => d.severity !== "info" && d.kind !== "missing-in-pds")
    .slice(0, maxFixes)
    .map(fmtFix);

  const pct = s.score.toFixed(1);
  let instruction: string;
  if (done) {
    instruction =
      `Pixel-perfect — ${pct}% (${s.importantMatched}/${s.importantTotal} key nodes built, ` +
      `${result.deltas.length} note(s) within tolerance). Stop: the build matches the design.`;
  } else if (result.matched === 0) {
    instruction =
      `Nothing matched yet (0%). Render the component, stamp data-plumb-id="<el>" on each ` +
      `element using the PDS handles, capture box + computed styles, and call plumb_fit again.`;
  } else {
    const it = opts.iteration ? `Iteration ${opts.iteration}: ` : "";
    const missing = s.importantTotal - s.importantMatched;
    const coverHint =
      missing > 0
        ? ` Then build the ${missing} key node(s) you haven't tagged yet — that's capping your score.`
        : "";
    const errPart = s.errors > 0 ? `${s.errors} error(s)` : "";
    const warnPart = s.warns > 0 ? `${s.warns} warning(s)` : "";
    const both = [errPart, warnPart].filter(Boolean).join(" and ");
    instruction =
      `${it}${pct}% — fix ${both || "the deltas"} below, re-render, and call plumb_fit again.${coverHint}`;
  }

  return {
    score: s.score,
    done,
    iteration: opts.iteration,
    matched: result.matched,
    importantMatched: s.importantMatched,
    importantTotal: s.importantTotal,
    errors: s.errors,
    warns: s.warns,
    bar: renderBar(s.score),
    topFixes,
    instruction,
  };
}

function fmtFix(d: Delta): string {
  const where = d.name ? `${d.el} (${d.name})` : d.el;
  return `${where} · ${d.kind}: expected ${fmtVal(d.expected)}, got ${fmtVal(d.actual)}`;
}

function fmtVal(v: string | number | null): string {
  if (v === null) return "—";
  return typeof v === "string" ? `"${v}"` : String(v);
}

/** A printable progress bar, e.g. ▰▰▰▰▰▰▰▰▱▱ for 80%. */
export function renderBar(score: number, width = 10): string {
  const filled = Math.round((clamp(score, 0, 100) / 100) * width);
  return "▰".repeat(filled) + "▱".repeat(Math.max(0, width - filled));
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}
