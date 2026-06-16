import { z } from "zod";
import { PlumbError } from "../errors";
import { emitStudio } from "../studio/events";
import { DEFAULT_TOLERANCES, verifyAgainst } from "../verify";
import { resolveVerifyTarget } from "./resolveTarget";
import { fail, ok } from "./shared";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Tolerances } from "../verify";

const DESCRIPTION =
  "Compare what you built against the Figma design and return structured deltas " +
  "— exact, deterministic, no pixel diff. After rendering, for every element " +
  'you tagged `data-plumb-id="<el>"` (or the globally-unique `data-plumb-id="<path>"` ' +
  "for deeply nested DOM), collect:\n" +
  "  • box — getBoundingClientRect() → { x, y, w, h }\n" +
  "  • styles — a subset of getComputedStyle: backgroundColor, color, " +
  "fontFamily, fontSize, fontWeight, lineHeight, padding{Top,Right,Bottom,Left}, " +
  "gap, flexDirection, justifyContent, alignItems, borderRadius, borderColor, " +
  "borderWidth, opacity, textDecorationLine\n" +
  "  • text — textContent for TEXT nodes\n" +
  "  • asset — for image/icon/logo nodes (assetId or vector): the " +
  'data-plumb-asset="<assetId>" you rendered, plus img:true when it is a real ' +
  "<img>/<svg> (not a redrawn div). Verify errors on a visual node rendered with " +
  "no real asset, so a redrawn/omitted logo lowers the score.\n" +
  "Pass them as `rendered`. The tool joins by `el` (loose) or `path` (strict) and " +
  "returns deltas like { kind:'size.w', expected:528, actual:530, severity:'warn' }. " +
  "The response also includes `coverage` — how many PDS els in the subtree were " +
  "actually tagged, plus an `untagged` list so you know what to add next round. " +
  "ok=true means no errors; warns are differences you may have meant.";

const renderedElementSchema = z.object({
  el: z.string(),
  box: z.object({
    x: z.number(),
    y: z.number(),
    w: z.number(),
    h: z.number(),
  }),
  text: z.string().optional(),
  styles: z.record(z.string(), z.string()).optional(),
});

/** Registers the `plumb_verify` MCP tool (plan §8, the closer). */
export function registerPlumbVerify(server: McpServer): void {
  server.registerTool(
    "plumb_verify",
    {
      title: "Plumb · verify",
      description: DESCRIPTION,
      inputSchema: {
        id: z.string().optional().describe("Screen id."),
        name: z.string().optional().describe("Screen name (plugin path)."),
        fileKey: z.string().optional().describe("File key (REST path)."),
        url: z
          .string()
          .optional()
          .describe(
            "Paste a full Figma URL — fileKey and node-id are auto-extracted.",
          ),
        rendered: z
          .array(renderedElementSchema)
          .describe('Each element you tagged data-plumb-id="<el>".'),
        viewport: z
          .object({ w: z.number(), h: z.number() })
          .optional()
          .describe("Browser viewport size (informational)."),
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
            "plumb_verify needs the rendered layout.",
            "For every element you tagged data-plumb-id, send { el, box: getBoundingClientRect(), styles: getComputedStyle subset }. See the tool description.",
          );
        }

        const depth = args.depth ?? 12;
        const target = await resolveVerifyTarget(args, depth);
        if (target.kind === "ambiguous") {
          return ok({
            ambiguous: true,
            matches: target.matches,
            next:
              "Several screens share that name. Each row shows `page` and " +
              "`box` (w×h) — pick the one you want and re-call plumb_verify with its `id`.",
          });
        }
        const { source, screen, pds } = target;

        const tolerances: Tolerances = {
          px: { ...DEFAULT_TOLERANCES.px, ...(args.tolerances?.px ?? {}) },
          color: { ...DEFAULT_TOLERANCES.color, ...(args.tolerances?.color ?? {}) },
        };

        const result = verifyAgainst(pds, args.rendered, tolerances);
        const errs = result.deltas.filter((d) => d.severity === "error").length;
        const warns = result.deltas.filter((d) => d.severity === "warn").length;

        emitStudio({
          kind: "tool",
          tool: "plumb_verify",
          screen,
          deltas: result.deltas
            .slice(0, 12)
            .map((d) => ({ el: d.el, kind: d.kind, severity: d.severity })),
          summary: `verify — ${result.matched} matched, ${errs} err / ${warns} warn`,
        });

        // Coverage-aware hint: 21% coverage with 0 deltas is a lie. Tell the
        // agent what they forgot to tag so the next round is actually useful.
        const cov = result.coverage;
        const coveragePct = cov ? Math.round(cov.coverage * 100) : 100;
        const lowCoverage = cov && cov.coverage < 0.6 && cov.untagged.length > 0;
        const taggingHint =
          cov && cov.untagged.length > 0
            ? ` Consider tagging more: ${cov.untagged.slice(0, 8).join(", ")}${cov.untagged.length > 8 ? ", …" : ""}.`
            : "";

        let next: string;
        if (result.ok && !lowCoverage) {
          next = `Pixel-perfect within tolerances — ${result.matched}/${cov?.pdsTotal ?? result.matched} matched (${coveragePct}% coverage), ${result.deltas.length} note(s).`;
        } else if (result.ok && lowCoverage) {
          next = `No deltas, but only ${coveragePct}% of the PDS subtree was tagged. "All matched" with ${coveragePct}% coverage is not the same as "the page is right".${taggingHint}`;
        } else {
          next = `Fix the ${errs} error(s)${warns ? ` and consider the ${warns} warning(s)` : ""}, then call plumb_verify again. Coverage: ${coveragePct}%.${
            result.unmatched > 0
              ? ` (${result.unmatched} rendered element(s) had no PDS match — check your data-plumb-id tags or increase \`depth\`.)`
              : ""
          }${taggingHint}`;
        }

        return ok({ source, screen, ...result, next });
      } catch (e) {
        return fail(e);
      }
    },
  );
}
