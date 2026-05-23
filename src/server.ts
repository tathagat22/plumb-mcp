import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SERVER_NAME, SERVER_VERSION } from "./meta";
import { registerPlumbAssets } from "./tools/assets";
import { registerPlumbComponents } from "./tools/components";
import { registerPlumbNode } from "./tools/node";
import { registerPlumbOutline } from "./tools/outline";
import { registerPlumbScreenshot } from "./tools/screenshot";
import { registerPlumbSearch } from "./tools/search";
import { registerPlumbSelection } from "./tools/selection";
import { registerPlumbStatus } from "./tools/status";
import { registerPlumbTokens } from "./tools/tokens";
import { registerPlumbVerify } from "./tools/verify";

/** Builds the Plumb MCP server with all tools registered. */
export function createServer(): McpServer {
  const server = new McpServer(
    { name: SERVER_NAME, version: SERVER_VERSION },
    {
      instructions:
        "Plumb extracts Figma designs as compact, normalized specs for building " +
        "UI, then verifies what you built. Call plumb_status first. With the " +
        "plugin paired: plumb_outline lists every screen; plumb_node extracts " +
        "one by id or name; plumb_selection extracts the live selection; " +
        "plumb_assets exports icons/images (list / surgical modes); " +
        "plumb_screenshot renders a node to PNG; plumb_search finds nodes; " +
        "plumb_components lists components and instances; plumb_verify diffs " +
        "your rendered layout against the design and returns structured deltas. " +
        "Otherwise use the REST path (fileKey + id). Auto-layout is " +
        "pre-resolved to flexbox.",
    },
  );

  registerPlumbStatus(server);
  registerPlumbOutline(server);
  registerPlumbNode(server);
  registerPlumbTokens(server);
  registerPlumbSelection(server);
  registerPlumbAssets(server);
  registerPlumbScreenshot(server);
  registerPlumbSearch(server);
  registerPlumbComponents(server);
  registerPlumbVerify(server);

  return server;
}
