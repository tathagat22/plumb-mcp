import { z } from "zod";
import { cacheGet, cacheSet, DEFAULT_TTL_MS } from "../cache";
import { fetchNodeViaRest } from "../figma/rest";
import { normalize } from "../normalize/normalize";
import { estimateTokens } from "../util/estimate";
import { fail, ok, requireToken } from "./shared";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { TokenTable } from "../pds";

const DESCRIPTION =
  "Extract the deduplicated design-token table for a Figma node — colours, " +
  "type styles, radii, shadows — as the $-prefixed refs the PDS node tree " +
  "uses. Build with these tokens, not magic numbers.";

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
        fileKey: z.string().describe("Figma file key."),
        id: z
          .string()
          .describe('Node id whose design tokens to extract, e.g. "131:9592".'),
      },
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
    },
    async (args) => {
      try {
        const cacheKey = `tokens:${args.fileKey}:${args.id}`;
        const hit = cacheGet<TokensResult>(cacheKey, DEFAULT_TTL_MS);
        if (hit) return ok({ ...hit.payload, cached: true });

        const token = requireToken();
        const file = await fetchNodeViaRest({
          fileKey: args.fileKey,
          nodeId: args.id,
          depth: 24,
          token,
        });
        const pds = normalize(file, 99, {});
        const result: TokensResult = {
          tokens: pds.tokens,
          meta: {
            fromNode: args.id,
            nodeCount: pds.meta.nodeCount,
            estTokens: estimateTokens(JSON.stringify(pds.tokens)),
          },
          note:
            "Tokens are deduplicated from node styles via the REST path. Figma " +
            "Variables (modes, aliases, scopes) require the plugin path.",
          next: "Use these $-refs while building; call plumb_node for the node tree.",
        };
        cacheSet(cacheKey, file.version, result);
        return ok({ ...result, cached: false });
      } catch (e) {
        return fail(e);
      }
    },
  );
}
