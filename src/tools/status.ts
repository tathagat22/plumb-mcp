import { KEY_LEGEND } from "../keylegend";
import { SERVER_NAME, SERVER_VERSION } from "../meta";
import { ok } from "./shared";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

const DESCRIPTION =
  "Plumb's status and self-description — call this FIRST. Reports which data " +
  "paths are available, the compact-key legend for reading every PDS response, " +
  "and the token budget. Needs no Figma access.";

/** Registers the `plumb_status` MCP tool (plan §8 / §6.1). */
export function registerPlumbStatus(server: McpServer): void {
  server.registerTool(
    "plumb_status",
    {
      title: "Plumb · status",
      description: DESCRIPTION,
      inputSchema: {},
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
    },
    async () => {
      const restConfigured = Boolean(
        process.env.FIGMA_TOKEN ?? process.env.FIGMA_ACCESS_TOKEN,
      );
      return ok({
        server: { name: SERVER_NAME, version: SERVER_VERSION, milestone: "M1 — REST path" },
        plugin: {
          connected: false,
          note:
            "The plugin path (live document + Figma Variables, no token) is in " +
            "development. Plumb currently uses the REST path.",
        },
        rest: {
          configured: restConfigured,
          note: restConfigured
            ? "FIGMA_TOKEN is set — the REST tools are ready."
            : "Set FIGMA_TOKEN to use the REST tools (figma.com → Settings → Security).",
        },
        tools: ["plumb_status", "plumb_outline", "plumb_node", "plumb_tokens"],
        legend: KEY_LEGEND,
        budget: {
          mcpCeiling: 25000,
          target: 10000,
          note:
            "Keep plumb_node responses within budget — drill with `depth` and " +
            "`more` instead of fetching whole screens at once.",
        },
        next: restConfigured
          ? "Call plumb_outline with a fileKey to map the file, then plumb_node on a frame id."
          : "Set FIGMA_TOKEN, then call plumb_outline.",
      });
    },
  );
}
