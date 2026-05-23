import { z } from "zod";
import { cacheGet, cacheSet, DEFAULT_TTL_MS } from "../cache";
import { formatScreenMatches, resolveScreen } from "../bridge/inventory";
import { requestNode } from "../bridge/server";
import { bridge } from "../bridge/store";
import { PlumbError } from "../errors";
import { fetchNodeViaRest } from "../figma/rest";
import { resolveFigmaTarget } from "../figma/url";
import { normalizeToBudget } from "../normalize/budget";
import { fail, ok, requireToken } from "./shared";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { FigmaFileResult } from "../figma/types";
import type { PdsDocument } from "../pds";

const DESCRIPTION =
  "Extract a Figma screen or node as a compact, normalized Plumb Design Spec " +
  "(PDS): deduplicated design tokens plus a CSS-shaped node tree, with " +
  "auto-layout pre-resolved to flexbox. With the Plumb plugin paired, pass a " +
  "screen `id` or `name` (no file key) — duplicate names come back as a match " +
  "list to disambiguate. On the REST path, pass `fileKey` + `id`.";

/** Registers the `plumb_node` MCP tool (plan §8). */
export function registerPlumbNode(server: McpServer): void {
  server.registerTool(
    "plumb_node",
    {
      title: "Plumb · node",
      description: DESCRIPTION,
      inputSchema: {
        fileKey: z
          .string()
          .optional()
          .describe("Figma file key — REST path. Omit when the Plumb plugin is paired."),
        url: z
          .string()
          .optional()
          .describe(
            "Paste a full Figma URL — fileKey and node-id are auto-extracted (the `-` separator is normalised to `:`).",
          ),
        id: z.string().optional().describe("Node/screen id to extract."),
        name: z
          .string()
          .optional()
          .describe("Screen name — plugin path; resolved against the paired file."),
        depth: z
          .number()
          .int()
          .min(1)
          .max(12)
          .optional()
          .describe("Levels to disclose. Default 3."),
        expandAll: z
          .boolean()
          .optional()
          .describe(
            "Walk the entire subtree in one call, ignoring `depth`. Subject " +
              "to `maxTokens` (defaults to 60000 if omitted); if the spec " +
              "exceeds the budget, depth is auto-trimmed and `meta.truncated` " +
              "is set. Use this to skip the drill-loop on dense screens.",
          ),
        notes: z
          .boolean()
          .optional()
          .describe("Include human-readable notes per node."),
        maxTokens: z
          .number()
          .int()
          .positive()
          .optional()
          .describe("Soft token budget; fit-to-budget reduces depth to fit."),
      },
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
    },
    async (args) => {
      try {
        const expandAll = args.expandAll === true;
        const depth = expandAll ? 12 : (args.depth ?? 3);
        // Always cap expandAll responses — agents can blow the context window
        // pulling a 47-node screen at depth 12 otherwise.
        const maxTokens =
          args.maxTokens ?? (expandAll ? 60_000 : undefined);
        const { fileKey, id } = resolveFigmaTarget({
          url: args.url,
          fileKey: args.fileKey,
          id: args.id,
        });

        // Plugin path — no file key, plugin paired.
        if (!fileKey && bridge.paired) {
          const resolved = resolveScreen(id, args.name);
          if ("ambiguous" in resolved) {
            return ok({
              ambiguous: true,
              matches: formatScreenMatches(resolved.ambiguous),
              next:
                "Several screens share that name. Each row shows `page` and " +
                "`box` (w×h) — pick the one you want and re-call plumb_node with its `id`.",
            });
          }
          const { doc, nodeName } = await requestNode(resolved.id);
          if (!doc) {
            throw new PlumbError(
              `The Plumb plugin could not find node "${resolved.id}".`,
              "Call plumb_outline for the current screen list — it may have been deleted or renamed.",
            );
          }
          const file: FigmaFileResult = {
            document: doc,
            fileName: bridge.inventory?.fileName ?? "",
            version: `plugin-${Date.now()}`,
          };
          const pds = normalizeToBudget(file, depth, maxTokens, { notes: args.notes });
          return ok({ ...pds, source: "plugin", node: nodeName });
        }

        // REST path — needs fileKey + id.
        if (!fileKey || !id) {
          throw new PlumbError(
            "plumb_node needs the Plumb plugin paired, or a fileKey + id (or a Figma url) for the REST path.",
            "Pair the Plumb plugin in Figma, paste a Figma URL via `url`, or pass both fileKey and id.",
          );
        }
        const cacheKey =
          `node:${fileKey}:${id}:${depth}:` +
          `${args.notes ? 1 : 0}:${maxTokens ?? 0}:${expandAll ? 1 : 0}`;
        const hit = cacheGet<PdsDocument>(cacheKey, DEFAULT_TTL_MS);
        if (hit) return ok({ ...hit.payload, source: "rest", cached: true });

        const token = requireToken();
        const file = await fetchNodeViaRest({
          fileKey,
          nodeId: id,
          depth: expandAll ? 12 : depth + 1,
          token,
        });
        const pds = normalizeToBudget(file, depth, maxTokens, { notes: args.notes });
        cacheSet(cacheKey, file.version, pds);
        return ok({ ...pds, source: "rest", cached: false });
      } catch (e) {
        return fail(e);
      }
    },
  );
}
