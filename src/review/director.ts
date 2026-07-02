/**
 * The vision creative-director axis — the THIRD grader `plumb_review` can
 * blend in alongside STRUCTURE (built-vs-authored fidelity) and DESIGN (the
 * deterministic six-dimension rubric in `./rubric`).
 *
 * Where `critiqueDesign` reasons over the PDS structurally, this axis grades
 * the *rendered pixels* — but there is no server-side vision model call here.
 * The MCP agent driving `plumb_review` (Claude Code or any MCP client) is
 * ALREADY a vision-capable model, and it already has the screenshot in hand
 * (from `plumb_screenshot`). So instead of the server spending an
 * `ANTHROPIC_API_KEY` on a second, redundant vision call, it hands the agent
 * `directorGuidance()` — the same demanding-art-director grading criteria a
 * server-side call would have used — and the agent grades the screenshot
 * itself, then passes its verdict back in as plain JSON.
 *
 * This module is pure JSON shaping: no network, no fetch, no API key. It
 * validates/coerces whatever the caller hands back into the same
 * `RubricIssue` shape `critiqueDesign` uses, so the two graders merge for
 * free in `buildReviewResponse`.
 */
import type { RubricDimensionId, RubricIssue, RubricSeverity } from "./rubric";

const RUBRIC_DIMENSIONS: RubricDimensionId[] = [
  "hierarchy",
  "spacing",
  "contrast",
  "alignment",
  "type-scale",
  "polish",
];
const SEVERITIES: RubricSeverity[] = ["error", "warn", "info"];

/** What the calling agent hands back after grading the rendered screenshot
 *  itself. Same shape whether it arrives as `DirectorVerdict` (raw, from the
 *  agent) or `DirectorSummary` (coerced, ready for `buildReviewResponse`). */
export interface DirectorVerdict {
  /** 0–100 — a human art-director's gut score of the rendered screen. */
  score: number;
  /** One-paragraph critique, echoed into the instruction. */
  verdict?: string;
  /** Mapped onto the SAME RubricIssue shape so it merges into topFixes for free. */
  issues: RubricIssue[];
}

/** The coerced, trusted form threaded into `buildReviewResponse`'s optional
 *  4th argument. */
export interface DirectorSummary {
  score: number;
  verdict?: string;
  issues: RubricIssue[];
}

function clamp(n: number, lo = 0, hi = 100): number {
  return Math.max(lo, Math.min(hi, n));
}

/** Coerce a raw parsed issue into the RubricIssue shape, dropping unknown
 *  dimension/severity to safe defaults rather than throwing. Returns null for
 *  anything with no usable message/fix. */
function coerceIssue(raw: unknown): RubricIssue | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const dimension: RubricDimensionId = RUBRIC_DIMENSIONS.includes(r.dimension as RubricDimensionId)
    ? (r.dimension as RubricDimensionId)
    : "polish";
  const severity: RubricSeverity = SEVERITIES.includes(r.severity as RubricSeverity)
    ? (r.severity as RubricSeverity)
    : "info";
  const message = typeof r.message === "string" ? r.message : "";
  const fix = typeof r.fix === "string" ? r.fix : "";
  if (!message && !fix) return null;
  const el = typeof r.el === "string" ? r.el : undefined;
  return { dimension, severity, message, fix, ...(el ? { el } : {}) };
}

/**
 * Validate/clamp whatever the calling agent hands back as its own vision
 * grade of the rendered screenshot into a trusted `DirectorSummary`. NEVER
 * throws — untrusted input degrades to a 0-score, no-issues, no-verdict
 * summary rather than blowing up the review call.
 */
export function coerceDirectorVerdict(raw: unknown): DirectorSummary {
  if (!raw || typeof raw !== "object") {
    return { score: 0, issues: [] };
  }
  const r = raw as Record<string, unknown>;
  const score = typeof r.score === "number" && Number.isFinite(r.score) ? clamp(r.score) : 0;
  const verdict = typeof r.verdict === "string" ? r.verdict : undefined;
  const rawIssues = Array.isArray(r.issues) ? r.issues : [];
  const issues = rawIssues.map(coerceIssue).filter((i): i is RubricIssue => i !== null);
  return { score, issues, ...(verdict ? { verdict } : {}) };
}

/**
 * The grading criteria handed to the calling agent — NOT sent to any model by
 * this server. The agent (which already has vision) reads this, looks at the
 * screenshot from `plumb_screenshot`, grades it itself, and passes the
 * resulting `{ score, verdict, issues }` back into `plumb_review`'s
 * `director` input.
 *
 * Grades the same six rubric dimension ids as `critiqueDesign` so the two
 * graders are directly comparable, PLUS the vision-only things a deterministic
 * pass over the PDS structurally cannot see.
 */
export function directorGuidance(): string {
  return (
    "Act as a demanding creative director reviewing a rendered screenshot. Grade the render you SEE " +
    "— not the intent, not the spec, the actual pixels. Be a demanding director, not a lenient one: " +
    "most first passes deserve real critique.\n\n" +
    "Grade against these six dimensions (the same a deterministic design rubric uses, so your verdict is " +
    "directly comparable):\n" +
    "  hierarchy    — is there a clear dominant heading vs body, does the eye know where to land first?\n" +
    "  spacing      — does the whitespace sit on a consistent, optically-even rhythm?\n" +
    "  contrast     — is text legible against its background at a glance?\n" +
    "  alignment    — does everything line up, or does it look ad-hoc/hand-placed?\n" +
    "  type-scale   — a small, harmonious set of font sizes, or a pile of arbitrary ones?\n" +
    "  polish       — crafted and considered, or does it read as a default template?\n\n" +
    "Plus the things only a rendered image reveals — fold these into whichever dimension fits (usually " +
    "polish or hierarchy):\n" +
    "  - visual balance / weight distribution across the canvas\n" +
    "  - focal flow — does the eye land where it should, then travel correctly through the screen\n" +
    "  - image composition, crop, subject placement, and whether photos/logos actually read\n" +
    "  - optical spacing — not grid math, does it *look* even\n" +
    "  - \"designed vs generated\" gestalt — does this look like a human designed it, or like a template a " +
    "machine emitted\n\n" +
    "Reserve \"error\" severity for a genuinely broken screen: unreadable text, a broken or redrawn logo, " +
    "overlapping content, or something that would embarrass the team if shipped.\n\n" +
    "Then call plumb_review again, passing your grade as the `director` argument:\n" +
    '{ "score": <0-100>, "verdict": "<one paragraph, your honest gut read>", ' +
    '"issues": [ { "dimension": "hierarchy|spacing|contrast|alignment|type-scale|polish", ' +
    '"severity": "error|warn|info", "message": "<what\'s wrong>", "fix": "<one concrete change>" } ] }'
  );
}
