import { z } from "zod";
import { fetchNodeViaRest } from "../figma/rest";
import { normalize } from "../normalize/normalize";
import { estimateTokens } from "../util/estimate";
import { fail, ok, requireToken } from "./shared";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

const DESCRIPTION =
  "Extract the deduplicated design-token table for a Figma node — colours, " +
  "type styles, radii, shadows — as the $-prefixed refs the PDS node tree " +
  "uses. Build with these tokens, not magic numbers.";

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
        const token = requireToken();
        const file = await fetchNodeViaRest({
          fileKey: args.fileKey,
          nodeId: args.id,
          depth: 24,
          token,
        });
        const pds = normalize(file, 99, {});
        return ok({
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
        });
      } catch (e) {
        return fail(e);
      }
    },
  );
}
