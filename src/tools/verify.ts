import { z } from "zod";
import { resolveScreen } from "../bridge/inventory";
import { requestNode } from "../bridge/server";
import { bridge } from "../bridge/store";
import { PlumbError } from "../errors";
import { fetchNodeViaRest } from "../figma/rest";
import { resolveFigmaTarget } from "../figma/url";
import { normalizeToBudget } from "../normalize/budget";
import { DEFAULT_TOLERANCES, verifyAgainst } from "../verify";
import { fail, ok, requireToken } from "./shared";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { FigmaFileResult } from "../figma/types";
import type { Tolerances } from "../verify";

const DESCRIPTION =
  "Compare what you built against the Figma design and return structured deltas " +
  "— exact, deterministic, no pixel diff. After rendering, for every element " +
  'you tagged `data-plumb-id="<el>"` (the el comes from the PDS plumb_node ' +
  "returned), collect:\n" +
  "  • box — getBoundingClientRect() → { x, y, w, h }\n" +
  "  • styles — a subset of getComputedStyle: backgroundColor, color, " +
  "fontFamily, fontSize, fontWeight, lineHeight, padding{Top,Right,Bottom,Left}, " +
  "gap, flexDirection, justifyContent, alignItems, borderRadius, borderColor, " +
  "borderWidth, opacity\n" +
  "  • text — textContent for TEXT nodes\n" +
  "Pass them as `rendered`. The tool fetches the live PDS, joins by `el`, and " +
  "returns deltas like { kind:'size.w', expected:528, actual:530, severity:'warn' }. " +
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
        const { fileKey, id } = resolveFigmaTarget({
          url: args.url,
          fileKey: args.fileKey,
          id: args.id,
        });
        let pds;
        let screen: string | null = null;
        const source: "plugin" | "rest" = bridge.paired && !fileKey ? "plugin" : "rest";

        if (source === "plugin") {
          const resolved = resolveScreen(id, args.name);
          if ("ambiguous" in resolved) {
            return ok({
              ambiguous: true,
              matches: resolved.ambiguous,
              next: "Several screens share that name — re-call plumb_verify with one of these `id` values.",
            });
          }
          const { doc, nodeName } = await requestNode(resolved.id);
          if (!doc) {
            throw new PlumbError(
              `The Plumb plugin could not find node "${resolved.id}".`,
              "Call plumb_outline for the current screen list — it may have been deleted or renamed.",
            );
          }
          screen = nodeName;
          const file: FigmaFileResult = {
            document: doc,
            fileName: bridge.inventory?.fileName ?? "",
            version: `plugin-${Date.now()}`,
          };
          pds = normalizeToBudget(file, depth, undefined, { notes: false });
        } else {
          if (!fileKey || !id) {
            throw new PlumbError(
              "plumb_verify needs the Plumb plugin paired (id/name), or a fileKey + id (or a Figma url) for the REST path.",
              "Pair the Plumb plugin in Figma, paste a Figma URL via `url`, or pass both fileKey and id.",
            );
          }
          const token = requireToken();
          const file = await fetchNodeViaRest({
            fileKey,
            nodeId: id,
            depth: depth + 1,
            token,
          });
          screen = file.document.name;
          pds = normalizeToBudget(file, depth, undefined, { notes: false });
        }

        const tolerances: Tolerances = {
          px: { ...DEFAULT_TOLERANCES.px, ...(args.tolerances?.px ?? {}) },
          color: { ...DEFAULT_TOLERANCES.color, ...(args.tolerances?.color ?? {}) },
        };

        const result = verifyAgainst(pds, args.rendered, tolerances);
        const errs = result.deltas.filter((d) => d.severity === "error").length;
        const warns = result.deltas.filter((d) => d.severity === "warn").length;

        return ok({
          source,
          screen,
          ...result,
          next: result.ok
            ? `Pixel-perfect within tolerances — ${result.matched} element(s) matched, ${result.deltas.length} note(s).`
            : `Fix the ${errs} error(s)${warns ? ` and consider the ${warns} warning(s)` : ""}, then call plumb_verify again.${
                result.unmatched > 0
                  ? ` (${result.unmatched} rendered element(s) had no PDS match — check your data-plumb-id tags or increase \`depth\`.)`
                  : ""
              }`,
        });
      } catch (e) {
        return fail(e);
      }
    },
  );
}
