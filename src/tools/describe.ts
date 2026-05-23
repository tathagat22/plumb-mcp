import { z } from "zod";
import { cacheGet, cacheSet, DEFAULT_TTL_MS } from "../cache";
import { formatScreenMatches, resolveScreen } from "../bridge/inventory";
import { requestNode } from "../bridge/server";
import { bridge } from "../bridge/store";
import { describePds } from "../describe";
import { PlumbError } from "../errors";
import { fetchNodeViaRest } from "../figma/rest";
import { resolveFigmaTarget } from "../figma/url";
import { normalizeToBudget } from "../normalize/budget";
import { fail, ok, requireToken } from "./shared";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { FigmaFileResult } from "../figma/types";
import type { PdsDocument } from "../pds";

const DESCRIPTION =
  "Text-only visual description of a Figma screen or node — useful when you " +
  "can't read the rendered screenshot (image-blind harness, sandboxed Read, " +
  "or token-conscious flows). Returns a per-region narrative ('top-left: ...') " +
  "and a flat child summary derived from the PDS. Pair with plumb_node for the " +
  "full structural spec, or pair with plumb_screenshot for the pixel reference.";

/** Registers the `plumb_describe` MCP tool. */
export function registerPlumbDescribe(server: McpServer): void {
  server.registerTool(
    "plumb_describe",
    {
      title: "Plumb · describe",
      description: DESCRIPTION,
      inputSchema: {
        fileKey: z.string().optional().describe("REST path file key."),
        url: z
          .string()
          .optional()
          .describe("Paste a full Figma URL — fileKey + node-id auto-extracted."),
        id: z.string().optional().describe("Node id to describe."),
        name: z.string().optional().describe("Screen name (plugin path)."),
        depth: z
          .number()
          .int()
          .min(1)
          .max(6)
          .optional()
          .describe("Levels of the tree to mine for the narrative. Default 2."),
      },
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
    },
    async (args) => {
      try {
        const depth = args.depth ?? 2;
        const { fileKey, id } = resolveFigmaTarget({
          url: args.url,
          fileKey: args.fileKey,
          id: args.id,
        });

        if (!fileKey && bridge.paired) {
          const resolved = resolveScreen(id, args.name);
          if ("ambiguous" in resolved) {
            return ok({
              ambiguous: true,
              matches: formatScreenMatches(resolved.ambiguous),
              next:
                "Several screens share that name. Each row shows `page` and " +
                "`box` (w×h) — pick the one you want and re-call plumb_describe with its `id`.",
            });
          }
          const { doc, nodeName } = await requestNode(resolved.id);
          if (!doc) {
            throw new PlumbError(
              `The Plumb plugin could not find node "${resolved.id}".`,
              "Call plumb_outline for the current screen list.",
            );
          }
          const file: FigmaFileResult = {
            document: doc,
            fileName: bridge.inventory?.fileName ?? "",
            version: `plugin-${Date.now()}`,
          };
          const pds = normalizeToBudget(file, depth, undefined);
          return ok({ ...describePds(pds), source: "plugin", screen: nodeName });
        }

        if (!fileKey || !id) {
          throw new PlumbError(
            "plumb_describe needs the Plumb plugin paired, or a fileKey + id (or a Figma url).",
            "Pair the plugin in Figma, paste a Figma URL via `url`, or pass both fileKey and id.",
          );
        }
        const cacheKey = `describe:${fileKey}:${id}:${depth}`;
        const hit = cacheGet<PdsDocument>(cacheKey, DEFAULT_TTL_MS);
        if (hit) return ok({ ...describePds(hit.payload), source: "rest", cached: true });

        const token = requireToken();
        const file = await fetchNodeViaRest({
          fileKey,
          nodeId: id,
          depth: depth + 1,
          token,
        });
        const pds = normalizeToBudget(file, depth, undefined);
        cacheSet(cacheKey, file.version, pds);
        return ok({ ...describePds(pds), source: "rest", cached: false });
      } catch (e) {
        return fail(e);
      }
    },
  );
}
