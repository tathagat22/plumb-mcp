/**
 * `plumb_review` — the write-direction self-critique / refine loop.
 *
 * The mirror of `plumb_fit`. Where fit closes the READ loop (you build HTML,
 * it scores your build against the Figma design), review closes the WRITE loop:
 * after `plumb_apply` emits a DSL design into Figma, review re-serializes the
 * *built* nodes back to a PDS and judges them on two axes at once —
 *
 *   • STRUCTURE — built-vs-authored fidelity, via the EXISTING verify engine.
 *     The just-emitted nodes are diffed against the PDS the compiler authored,
 *     joined by `EmitResult.ids` (authored el → Figma node id).
 *   • DESIGN — a deterministic six-dimension rubric (hierarchy, spacing,
 *     contrast/a11y, alignment, type-scale, professional-vs-templated).
 *
 * It returns one blended 0–100 `score`, a `done` flag, and a prioritised
 * `topFixes` list in the same shape `plumb_fit` returns — so the agent can
 * loop: apply → review → refine the DSL → re-apply (mode:"sync") → review,
 * converging on a build that is both faithful AND good.
 */
import { existsSync, readFileSync } from "node:fs";
import { z } from "zod";
import { PlumbError } from "../errors";
import {
  applyRemap,
  buildReviewResponse,
  coerceDirectorVerdict,
  critiqueDesign,
  DEFAULT_REVIEW_ACCEPT,
  directorGuidance,
  pdsToRendered,
  remapBuiltToAuthored,
} from "../review";
import { emitStudio } from "../studio/events";
import { DEFAULT_TOLERANCES, verifyAgainst } from "../verify";
import { resolveVerifyTarget } from "./resolveTarget";
import { fail, ok } from "./shared";
import type { ReviewBrief } from "../review";
import type { PdsDocument } from "../pds";
import type { Tolerances } from "../verify";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

const DESCRIPTION =
  "Self-critique the design you just emitted into Figma, and coach the refine " +
  "loop — the write-direction mirror of plumb_fit. It scores up to three axes:\n" +
  "  • STRUCTURE — re-serializes the built Figma nodes to a PDS and diffs them " +
  "against the PDS your DSL compiled to (did emit build what you authored?). " +
  "Uses the same verify engine as plumb_verify/plumb_fit. The two docs are " +
  "joined by `ids` = EmitResult.ids (authored el → Figma node id) — pass it or " +
  "the diff can't line up.\n" +
  "  • DESIGN — a deterministic rubric over hierarchy, spacing rhythm, " +
  "contrast (WCAG AA), alignment, type-scale, and professional-vs-templated " +
  "polish. Failing contrast is an error and blocks `done`.\n" +
  "  • DIRECTOR (optional, `director: {score, verdict?, issues?}`) — a vision " +
  "creative-director grade of the rendered screenshot: visual balance, focal " +
  "flow, image composition/crop, optical spacing, and the \"designed vs " +
  "generated\" gestalt a deterministic pass over the PDS can't see. There is " +
  "NO server-side vision call and NO API key needed here — YOU (the calling " +
  "agent) already have vision, so YOU grade the screenshot yourself and pass " +
  "your verdict in. The loop: call plumb_screenshot on the emitted rootId, " +
  "look at the PNG, grade it as a demanding creative director (any response " +
  "with no `director` input echoes the exact grading criteria + output shape " +
  "at the end of its `instruction`), then call plumb_review again passing " +
  "`director: { score, verdict, issues }`. With the " +
  "director present, weights reshuffle to structure 0.4 / design 0.3 / " +
  "director 0.3 and a director error-severity issue blocks `done` too, so the " +
  "bar is harder (and more honest) to clear.\n" +
  "Returns: score (0–100 blended), done, bar, topFixes (error-first across all " +
  "active axes, director fixes tagged `[director/<dim>]`), instruction, " +
  "dimensions[] (per-rubric-dimension sub-scores), directorScore/directorVerdict " +
  "when graded, plus the raw structural deltas + coverage. Provide the authored " +
  "PDS inline via `authored`, or a path to it via `authoredPath` (the JSON " +
  "plumb_apply writes). Point id/name/url at the emitted root " +
  "(EmitResult.rootId). Canonical loop: plumb_design → repeat[ plumb_screenshot " +
  "(rootId) → grade it yourself → plumb_review(..., director: {score, issues}) " +
  "→ if !done, apply topFixes and plumb_design(mode:\"sync\") ] until done or " +
  "an iteration cap. If done=false, apply topFixes, re-apply the DSL " +
  "(mode:\"sync\" keeps plumbKey), and call plumb_review again — the score " +
  "should climb.";

/** Loose brief validator — every field optional (see ReviewBrief). */
const briefSchema = z
  .object({
    typeSizes: z.array(z.number()).optional(),
    fonts: z.array(z.string()).optional(),
    spacingBase: z.number().optional(),
    note: z.string().optional(),
  })
  .optional();

/**
 * Coerce an untyped authored-PDS payload to a PdsDocument, or throw a clear
 * PlumbError. We don't re-run the full PDS zod (there isn't one) — we just
 * assert the load-bearing shape the diff needs: root + nodes + tokens.
 */
function coerceAuthored(raw: unknown, where: string): PdsDocument {
  // Some MCP clients JSON-stringify untyped object params — accept a JSON string.
  if (typeof raw === "string") {
    try {
      raw = JSON.parse(raw);
    } catch {
      /* fall through → the not-an-object error below reports it */
    }
  }
  if (!raw || typeof raw !== "object") {
    throw new PlumbError(
      `The authored PDS from ${where} is not an object.`,
      "Pass the PdsDocument the compiler produced (it has { root, nodes, tokens }).",
    );
  }
  const doc = raw as Partial<PdsDocument>;
  if (typeof doc.root !== "string" || !doc.nodes || !doc.tokens) {
    throw new PlumbError(
      `The authored PDS from ${where} is missing root/nodes/tokens.`,
      "Provide the full PdsDocument that plumb_apply compiled and emitted.",
    );
  }
  return raw as PdsDocument;
}

/** Registers the `plumb_review` MCP tool (blueprint §9, task `critique`). */
export function registerPlumbReview(server: McpServer): void {
  server.registerTool(
    "plumb_review",
    {
      title: "Plumb · review",
      description: DESCRIPTION,
      inputSchema: {
        id: z.string().optional().describe("Emitted root node id (EmitResult.rootId)."),
        name: z.string().optional().describe("Screen name (plugin path)."),
        fileKey: z.string().optional().describe("File key (REST path)."),
        url: z
          .string()
          .optional()
          .describe("Paste a full Figma URL — fileKey and node-id are auto-extracted."),
        authored: z
          .any()
          .optional()
          .describe("The authored PdsDocument (what the DSL compiled to). Inline alternative to authoredPath."),
        authoredPath: z
          .string()
          .optional()
          .describe("Path to a JSON file holding the authored PdsDocument (written by plumb_apply)."),
        ids: z
          .record(z.string(), z.string())
          .optional()
          .describe("EmitResult.ids — authored el → Figma node id. The join key for the structural diff."),
        brief: briefSchema.describe("Optional design intent (type scale, fonts, spacing grid) to grade against."),
        accept: z
          .number()
          .min(0)
          .max(100)
          .optional()
          .describe(`Blended score at which to stop. Default ${DEFAULT_REVIEW_ACCEPT}.`),
        iteration: z
          .number()
          .int()
          .positive()
          .optional()
          .describe("Which refine pass this is (1, 2, 3…). Informational — sharpens the coaching."),
        tolerances: z
          .object({
            px: z.object({ ok: z.number(), warn: z.number() }).optional(),
            color: z.object({ ok: z.number(), warn: z.number() }).optional(),
          })
          .optional()
          .describe("Override default structural thresholds."),
        depth: z
          .number()
          .int()
          .positive()
          .optional()
          .describe("PDS depth to re-serialize. Default 12."),
        director: z
          .object({
            score: z.number().min(0).max(100),
            verdict: z.string().optional(),
            issues: z
              .array(
                z.object({
                  dimension: z.enum([
                    "hierarchy",
                    "spacing",
                    "contrast",
                    "alignment",
                    "type-scale",
                    "polish",
                  ]),
                  severity: z.enum(["error", "warn", "info"]),
                  el: z.string().optional(),
                  message: z.string(),
                  fix: z.string(),
                }),
              )
              .optional(),
          })
          .optional()
          .describe(
            "YOUR OWN vision grade of the rendered screenshot — no server-side model call, no " +
              "API key. Look at the PNG from plumb_screenshot, grade it yourself as a demanding " +
              "creative director (see directorGuidance in a no-director response for the exact " +
              "criteria), and pass { score, verdict?, issues? } here. When present, reweights the " +
              "blend to structure 0.4 / design 0.3 / director 0.3 and a director error blocks `done`.",
          ),
      },
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
    },
    async (args) => {
      try {
        // --- Load the authored PDS (inline or from disk) --------------------
        let authored: PdsDocument;
        if (args.authored !== undefined) {
          authored = coerceAuthored(args.authored, "the `authored` argument");
        } else if (args.authoredPath) {
          if (!existsSync(args.authoredPath)) {
            throw new PlumbError(
              `authoredPath does not exist: ${args.authoredPath}`,
              "Pass the JSON path plumb_apply wrote, or the authored PDS inline via `authored`.",
            );
          }
          let parsed: unknown;
          try {
            parsed = JSON.parse(readFileSync(args.authoredPath, "utf8"));
          } catch (e) {
            throw new PlumbError(
              `Could not parse authoredPath as JSON: ${(e as Error).message}`,
              "Ensure the file holds the PdsDocument plumb_apply serialized.",
            );
          }
          authored = coerceAuthored(parsed, args.authoredPath);
        } else {
          throw new PlumbError(
            "plumb_review needs the authored design to compare against.",
            "Pass the PdsDocument the compiler produced via `authored`, or its path via `authoredPath`.",
          );
        }

        // --- Re-serialize the BUILT Figma nodes back to a PDS ---------------
        const depth = args.depth ?? 12;
        const target = await resolveVerifyTarget(args, depth);
        if (target.kind === "ambiguous") {
          return ok({
            ambiguous: true,
            matches: target.matches,
            next:
              "Several screens share that name. Each row shows `page` and `box` " +
              "(w×h) — pick the emitted one and re-call plumb_review with its `id`.",
          });
        }
        const { source, screen, pds: built } = target;

        // --- STRUCTURE: built (as rendered) vs authored, joined by ids ------
        const remap = remapBuiltToAuthored(built, args.ids);
        const rendered = applyRemap(pdsToRendered(built), remap);
        const tolerances: Tolerances = {
          px: { ...DEFAULT_TOLERANCES.px, ...(args.tolerances?.px ?? {}) },
          color: { ...DEFAULT_TOLERANCES.color, ...(args.tolerances?.color ?? {}) },
        };
        const structure = verifyAgainst(authored, rendered, tolerances);

        // --- DESIGN: rubric over what actually got built --------------------
        const rubric = critiqueDesign(built, args.brief as ReviewBrief | undefined);

        // --- DIRECTOR (optional): the CALLING AGENT's own vision grade of the
        // rendered screenshot. No server-side model call, no API key — the
        // agent already has vision and already has the PNG from
        // plumb_screenshot, so it grades itself and hands the verdict in.
        const director = args.director ? coerceDirectorVerdict(args.director) : undefined;

        // --- Blend ----------------------------------------------------------
        const review = buildReviewResponse(
          structure,
          rubric,
          { accept: args.accept, iteration: args.iteration },
          director,
        );

        // Surface convergence to any open Studio cockpit, live (fit channel).
        emitStudio({
          kind: "fit",
          tool: "plumb_review",
          screen,
          score: review.score,
          done: review.done,
          matched: review.matched,
          importantMatched: review.importantMatched,
          importantTotal: review.importantTotal,
          deltas: structure.deltas
            .slice(0, 12)
            .map((d) => ({ el: d.el, kind: d.kind, severity: d.severity })),
          summary:
            `review ${review.score.toFixed(1)}% — struct ${review.structureScore.toFixed(1)} / design ${review.designScore}` +
            (director ? ` / director ${review.directorScore}` : "") +
            (review.done ? " · done ✓" : ""),
        });

        // No director grade this pass — coach the agent to add one next time.
        // There's no server-side vision call: the agent already has vision
        // and already has the PNG (from plumb_screenshot), so it grades the
        // screenshot itself and passes the verdict back as `director`.
        if (!director) {
          review.instruction =
            `${review.instruction} For a sharper (and stricter) review, screenshot the ` +
            `emitted rootId with plumb_screenshot, grade it yourself as a demanding creative ` +
            `director, then call plumb_review again passing director:{score,verdict,issues}. ` +
            `Grading criteria: ${directorGuidance()}`;
        }

        if (remap.size === 0 && args.ids === undefined) {
          review.instruction =
            "No `ids` given — built and authored nodes were joined by raw el, which " +
            "usually won't line up. Pass EmitResult.ids for a real structural diff. " +
            review.instruction;
        }

        return ok({
          source,
          screen,
          score: review.score,
          structureScore: review.structureScore,
          designScore: review.designScore,
          directorScore: review.directorScore,
          directorVerdict: review.directorVerdict,
          done: review.done,
          bar: review.bar,
          iteration: review.iteration,
          matched: review.matched,
          importantMatched: review.importantMatched,
          importantTotal: review.importantTotal,
          structureErrors: review.structureErrors,
          structureWarns: review.structureWarns,
          dimensions: review.dimensions,
          topFixes: review.topFixes,
          instruction: review.instruction,
          rubric: {
            overall: rubric.overall,
            dimensions: rubric.dimensions,
            issues: rubric.issues,
            directorIssues: director?.issues ?? [],
          },
          deltas: structure.deltas,
          coverage: structure.coverage,
        });
      } catch (e) {
        return fail(e);
      }
    },
  );
}
