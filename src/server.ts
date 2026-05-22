import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SERVER_NAME, SERVER_VERSION } from "./meta";
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
        "UI. Call plumb_status first to learn the key legend and what is " +
        "connected. With the Plumb plugin paired, plumb_selection extracts the " +
        "user's live Figma selection (no token, no rate limit). Otherwise " +
        "plumb_outline maps a file and plumb_node extracts a frame by id; " +
        "plumb_tokens returns the design-token table. Auto-layout is " +
        "pre-resolved to flexbox.",
    },
  );

  registerPlumbStatus(server);
  registerPlumbOutline(server);
  registerPlumbNode(server);
  registerPlumbTokens(server);
  registerPlumbSelection(server);

  return server;
}
