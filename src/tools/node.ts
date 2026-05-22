import { z } from "zod";
import { cacheGet, cacheSet, DEFAULT_TTL_MS } from "../cache";
import { resolveScreen } from "../bridge/inventory";
import { requestNode } from "../bridge/server";
import { bridge } from "../bridge/store";
import { PlumbError } from "../errors";
import { fetchNodeViaRest } from "../figma/rest";
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
        const depth = args.depth ?? 3;

        // Plugin path — no file key, plugin paired.
        if (!args.fileKey && bridge.paired) {
          const resolved = resolveScreen(args.id, args.name);
          if ("ambiguous" in resolved) {
            return ok({
              ambiguous: true,
              matches: resolved.ambiguous,
              next: "Several screens share that name — re-call plumb_node with one of these `id` values.",
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
          const pds = normalizeToBudget(file, depth, args.maxTokens, { notes: args.notes });
          return ok({ ...pds, source: "plugin", node: nodeName });
        }

        // REST path — needs fileKey + id.
        if (!args.fileKey || !args.id) {
          throw new PlumbError(
            "plumb_node needs the Plumb plugin paired, or a fileKey + id for the REST path.",
            "Pair the Plumb plugin in Figma, or pass both fileKey and id.",
          );
        }
        const cacheKey =
          `node:${args.fileKey}:${args.id}:${depth}:` +
          `${args.notes ? 1 : 0}:${args.maxTokens ?? 0}`;
        const hit = cacheGet<PdsDocument>(cacheKey, DEFAULT_TTL_MS);
        if (hit) return ok({ ...hit.payload, source: "rest", cached: true });

        const token = requireToken();
        const file = await fetchNodeViaRest({
          fileKey: args.fileKey,
          nodeId: args.id,
          depth: depth + 1,
          token,
        });
        const pds = normalizeToBudget(file, depth, args.maxTokens, { notes: args.notes });
        cacheSet(cacheKey, file.version, pds);
        return ok({ ...pds, source: "rest", cached: false });
      } catch (e) {
        return fail(e);
      }
    },
  );
}
