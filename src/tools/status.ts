import { flatScreens } from "../bridge/inventory";
import { bridge } from "../bridge/store";
import { KEY_LEGEND } from "../keylegend";
import { SERVER_NAME, SERVER_VERSION } from "../meta";
import { ok } from "./shared";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

const DESCRIPTION =
  "Plumb's status and self-description — call this FIRST. Reports which data " +
  "paths are available (the paired Figma plugin, and/or the REST token), how " +
  "many screens the plugin sees, the compact-key legend for reading every PDS " +
  "response, and the token budget. Needs no Figma access.";

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
      const screenCount = bridge.inventory ? flatScreens().length : 0;
      return ok({
        server: { name: SERVER_NAME, version: SERVER_VERSION, milestone: "M1.5" },
        plugin: {
          connected: bridge.paired,
          bridgePort: bridge.port,
          pluginVersion: bridge.pluginVersion,
          fileName: bridge.inventory?.fileName ?? null,
          screens: screenCount,
          selection: bridge.selection ? bridge.selection.nodeName : null,
          note: bridge.paired
            ? `Plugin paired — ${screenCount} screen(s) available. Use plumb_outline to list them, then plumb_node / plumb_assets by id or name (no token, no rate limit).`
            : bridge.port !== null
              ? "Bridge is listening, but no plugin has paired. In Figma, run the Plumb plugin and click 'Pair with Plumb'."
              : "The plugin bridge is not running; the REST tools still work.",
        },
        rest: {
          configured: restConfigured,
          note: restConfigured
            ? "FIGMA_TOKEN is set — the REST tools are ready."
            : "Set FIGMA_TOKEN to use the REST tools (figma.com → Settings → Security).",
        },
        tools: [
          "plumb_status",
          "plumb_outline",
          "plumb_node",
          "plumb_tokens",
          "plumb_selection",
          "plumb_assets",
        ],
        legend: KEY_LEGEND,
        budget: {
          mcpCeiling: 25000,
          target: 10000,
          note:
            "Keep responses within budget — drill with `depth` and `more`, or " +
            "pass `maxTokens` to let fit-to-budget pick the depth.",
        },
        next: bridge.paired
          ? "Call plumb_outline to see every screen, then plumb_node by id or name."
          : restConfigured
            ? "Call plumb_outline with a fileKey, then plumb_node on a screen id."
            : "Pair the Plumb plugin, or set FIGMA_TOKEN for the REST path.",
      });
    },
  );
}
