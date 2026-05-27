import { z } from "zod";
import { cacheGet, cacheSet, DEFAULT_TTL_MS } from "../cache";
import { formatScreenMatches, resolveScreen } from "../bridge/inventory";
import { requestNode } from "../bridge/server";
import { bridge } from "../bridge/store";
import { PlumbError } from "../errors";
import { fetchNodeViaRest } from "../figma/rest";
import { resolveFigmaTarget } from "../figma/url";
import { normalize } from "../normalize/normalize";
import { estimateTokens } from "../util/estimate";
import { fail, ok, requireToken } from "./shared";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { FigmaFileResult } from "../figma/types";
import type { TokenTable } from "../pds";

const DESCRIPTION =
  "Extract the deduplicated design-token table for a Figma node — colours, " +
  "type styles, radii, shadows — as the $-prefixed refs the PDS node tree " +
  "uses. With the Plumb plugin paired, pass a screen `id` or `name` (no file " +
  "key). On the REST path, pass `fileKey` + `id`. Build with these tokens, " +
  "not magic numbers.";

interface TokensResult {
  tokens: TokenTable;
  meta: { fromNode: string; nodeCount: number; estTokens: number };
  note: string;
  next: string;
}

/** Registers the `plumb_tokens` MCP tool (plan §8). */
export function registerPlumbTokens(server: McpServer): void {
  server.registerTool(
    "plumb_tokens",
    {
      title: "Plumb · tokens",
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
            "Paste a full Figma URL — fileKey and node-id are auto-extracted.",
          ),
        id: z
          .string()
          .optional()
          .describe('Node id whose design tokens to extract, e.g. "131:9592".'),
        name: z
          .string()
          .optional()
          .describe("Screen name — plugin path; resolved against the paired file."),
      },
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
    },
    async (args) => {
      try {
        const { fileKey, id } = resolveFigmaTarget({
          url: args.url,
          fileKey: args.fileKey,
          id: args.id,
        });

        // Plugin path — same shape as plumb_node: a plain id or screen name
        // is enough when the plugin is paired. Without this branch the tool
        // demands fileKey+id even though the plugin can serve the same data
        // for free.
        if (bridge.paired && (id || args.name)) {
          const resolved = resolveScreen(id, args.name);
          if ("ambiguous" in resolved) {
            return ok({
              ambiguous: true,
              matches: formatScreenMatches(resolved.ambiguous),
              next:
                "Several screens share that name. Each row shows `page` and " +
                "`box` (w×h) — pick the one you want and re-call plumb_tokens with its `id`.",
            });
          }
          const { doc } = await requestNode(resolved.id);
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
          const pds = normalize(file, 99, {});
          const result: TokensResult = {
            tokens: pds.tokens,
            meta: {
              fromNode: resolved.id,
              nodeCount: pds.meta.nodeCount,
              estTokens: estimateTokens(JSON.stringify(pds.tokens)),
            },
            note:
              "Tokens are deduplicated across the entire subtree. Variable " +
              "bindings (modes, aliases) surface on the PDS node fills/strokes.",
            next: "Use these $-refs while building; call plumb_node for the node tree.",
          };
          return ok({ ...result, source: "plugin" });
        }

        // REST path — needs fileKey + id.
        if (!fileKey || !id) {
          throw new PlumbError(
            "plumb_tokens needs the Plumb plugin paired, or a fileKey + id (or a Figma url) for the REST path.",
            "Pair the Plumb plugin in Figma, paste a Figma URL via `url`, or pass both fileKey and id.",
          );
        }
        const cacheKey = `tokens:${fileKey}:${id}`;
        const hit = cacheGet<TokensResult>(cacheKey, DEFAULT_TTL_MS);
        if (hit) return ok({ ...hit.payload, source: "rest", cached: true });

        const token = requireToken();
        const file = await fetchNodeViaRest({
          fileKey,
          nodeId: id,
          depth: 24,
          token,
        });
        const pds = normalize(file, 99, {});
        const result: TokensResult = {
          tokens: pds.tokens,
          meta: {
            fromNode: id,
            nodeCount: pds.meta.nodeCount,
            estTokens: estimateTokens(JSON.stringify(pds.tokens)),
          },
          note:
            "Tokens are deduplicated from node styles via the REST path. Figma " +
            "Variables (modes, aliases, scopes) require the plugin path.",
          next: "Use these $-refs while building; call plumb_node for the node tree.",
        };
        cacheSet(cacheKey, file.version, result);
        return ok({ ...result, source: "rest", cached: false });
      } catch (e) {
        return fail(e);
      }
    },
  );
}
