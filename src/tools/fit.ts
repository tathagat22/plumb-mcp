/**
 * `plumb_fit` — the self-healing build loop.
 *
 * Same inputs as `plumb_verify` (you render, tag with data-plumb-id, capture
 * box + computed styles, pass `rendered`), but instead of a flat delta list it
 * returns a single 0–100 convergence `score`, a prioritised `topFixes` list,
 * and a `done` flag. The agent applies the fixes, re-renders, and calls again
 * — converging to a pixel-perfect match. The score folds in *coverage* (did
 * you build every key node?) and *fidelity* (is each one within tolerance?),
 * so it climbs as you both build more and fix deltas.
 */
import { z } from "zod";
import { PlumbError } from "../errors";
import { buildFitResponse, DEFAULT_ACCEPT } from "../fit";
import { emitStudio } from "../studio/events";
import { DEFAULT_TOLERANCES, verifyAgainst } from "../verify";
import { resolveVerifyTarget } from "./resolveTarget";
import { fail, ok } from "./shared";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Tolerances } from "../verify";

const DESCRIPTION =
  "Self-healing build loop — iterate to a pixel-perfect match instead of a " +
  "one-shot check. The loop:\n" +
  '  1. Build the component, stamping data-plumb-id="<el>" on each element ' +
  "using the PDS handles (same `el` keys plumb_node/plumb_query return).\n" +
  "  2. Capture box (getBoundingClientRect) + the getComputedStyle subset " +
  "(backgroundColor, color, font*, padding*, gap, flex*, justifyContent, " +
  "alignItems, borderRadius/Color/Width, opacity, textDecorationLine) + text " +
  "for every tagged element. Same shape as plumb_verify.\n" +
  "  3. Call plumb_fit with `rendered`. You get back:\n" +
  "       • score    — 0–100 convergence (coverage × fidelity), climbs as you go\n" +
  "       • done     — true once score ≥ accept (default 98) and no errors remain\n" +
  "       • topFixes — the highest-leverage changes, sorted error-first\n" +
  "       • bar      — a printable ▰▱ progress bar\n" +
  "       • instruction — what to do next\n" +
  "  4. If done=false, apply topFixes, re-render, call plumb_fit again. Repeat " +
  "until done=true. Each round the score should rise; if it stalls, read the " +
  "full `deltas` and `coverage.untagged` to see what you missed.";

const renderedElementSchema = z.object({
  el: z.string(),
  box: z.object({ x: z.number(), y: z.number(), w: z.number(), h: z.number() }),
  text: z.string().optional(),
  styles: z.record(z.string(), z.string()).optional(),
});

/** Registers the `plumb_fit` MCP tool — verify wrapped in a convergence loop. */
export function registerPlumbFit(server: McpServer): void {
  server.registerTool(
    "plumb_fit",
    {
      title: "Plumb · fit",
      description: DESCRIPTION,
      inputSchema: {
        id: z.string().optional().describe("Screen id."),
        name: z.string().optional().describe("Screen name (plugin path)."),
        fileKey: z.string().optional().describe("File key (REST path)."),
        url: z
          .string()
          .optional()
          .describe("Paste a full Figma URL — fileKey and node-id are auto-extracted."),
        rendered: z
          .array(renderedElementSchema)
          .describe('Each element you tagged data-plumb-id="<el>", with box + styles.'),
        iteration: z
          .number()
          .int()
          .positive()
          .optional()
          .describe("Which pass this is (1, 2, 3…). Informational — sharpens the coaching."),
        accept: z
          .number()
          .min(0)
          .max(100)
          .optional()
          .describe(`Score at which to stop. Default ${DEFAULT_ACCEPT}.`),
        tolerances: z
          .object({
            px: z.object({ ok: z.number(), warn: z.number() }).optional(),
            color: z.object({ ok: z.number(), warn: z.number() }).optional(),
          })
          .optional()
          .describe("Override default thresholds."),
        depth: z
          .number()
          .int()
          .positive()
          .optional()
          .describe("PDS depth to fetch. Default 12 — deep enough for most screens."),
      },
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
    },
    async (args) => {
      try {
        if (!args.rendered || args.rendered.length === 0) {
          throw new PlumbError(
            "plumb_fit needs the rendered layout.",
            'For every element you tagged data-plumb-id, send { el, box: getBoundingClientRect(), styles: getComputedStyle subset }. Then call plumb_fit again each round until done=true.',
          );
        }

        const depth = args.depth ?? 12;
        const target = await resolveVerifyTarget(args, depth);
        if (target.kind === "ambiguous") {
          return ok({
            ambiguous: true,
            matches: target.matches,
            next:
              "Several screens share that name. Each row shows `page` and `box` " +
              "(w×h) — pick the one you want and re-call plumb_fit with its `id`.",
          });
        }
        const { source, screen, pds } = target;

        const tolerances: Tolerances = {
          px: { ...DEFAULT_TOLERANCES.px, ...(args.tolerances?.px ?? {}) },
          color: { ...DEFAULT_TOLERANCES.color, ...(args.tolerances?.color ?? {}) },
        };

        const result = verifyAgainst(pds, args.rendered, tolerances);
        const fit = buildFitResponse(result, {
          accept: args.accept,
          iteration: args.iteration,
        });

        // Surface the convergence to any open Studio cockpit, live.
        emitStudio({
          kind: "fit",
          tool: "plumb_fit",
          screen,
          score: fit.score,
          done: fit.done,
          matched: fit.matched,
          importantMatched: fit.importantMatched,
          importantTotal: fit.importantTotal,
          deltas: result.deltas
            .slice(0, 12)
            .map((d) => ({ el: d.el, kind: d.kind, severity: d.severity })),
          summary: `fit ${fit.score.toFixed(1)}% — ${fit.errors} err / ${fit.warns} warn${fit.done ? " · done ✓" : ""}`,
        });

        // Return the coaching payload up front, then the raw deltas + coverage
        // so a stalled loop can dig past the curated topFixes.
        return ok({
          source,
          screen,
          score: fit.score,
          done: fit.done,
          bar: fit.bar,
          iteration: fit.iteration,
          matched: fit.matched,
          importantMatched: fit.importantMatched,
          importantTotal: fit.importantTotal,
          errors: fit.errors,
          warns: fit.warns,
          topFixes: fit.topFixes,
          instruction: fit.instruction,
          deltas: result.deltas,
          coverage: result.coverage,
        });
      } catch (e) {
        return fail(e);
      }
    },
  );
}
