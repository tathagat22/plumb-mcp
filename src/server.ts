import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SERVER_NAME, SERVER_VERSION } from "./meta";
import { registerPlumbAssets } from "./tools/assets";
import { registerPlumbNode } from "./tools/node";
import { registerPlumbOutline } from "./tools/outline";
import { registerPlumbSelection } from "./tools/selection";
import { registerPlumbStatus } from "./tools/status";
import { registerPlumbTokens } from "./tools/tokens";

/** Builds the Plumb MCP server with all tools registered. */
export function createServer(): McpServer {
  const server = new McpServer(
    { name: SERVER_NAME, version: SERVER_VERSION },
    {
      instructions:
        "Plumb extracts Figma designs as compact, normalized specs for building " +
        "UI. Call plumb_status first. With the Plumb plugin paired, plumb_outline " +
        "lists every screen and plumb_node extracts one by id or name (no token); " +
        "plumb_selection extracts the live selection; plumb_assets exports a " +
        "screen's icons and images to local files. Otherwise use the REST path " +
        "(fileKey + id). Auto-layout is pre-resolved to flexbox.",
    },
  );

  registerPlumbStatus(server);
  registerPlumbOutline(server);
  registerPlumbNode(server);
  registerPlumbTokens(server);
  registerPlumbSelection(server);
  registerPlumbAssets(server);

  return server;
}
