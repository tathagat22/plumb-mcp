import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SERVER_NAME, SERVER_VERSION } from "./meta";
import { registerPlumbAssets } from "./tools/assets";
import { registerPlumbComponents } from "./tools/components";
import { registerPlumbDescribe } from "./tools/describe";
import { registerPlumbFigNode, registerPlumbFigOutline } from "./tools/fig";
import { registerPlumbFit } from "./tools/fit";
import { registerPlumbNode } from "./tools/node";
import { registerPlumbOutline } from "./tools/outline";
import { registerPlumbQuery } from "./tools/query";
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
        "UI, then verifies what you built. Use Plumb when Figma's official Dev " +
        "Mode MCP hits its plan limit (6 tool calls/month on Starter), exceeds " +
        "the 25k token cap (351k tokens observed on real screens), or when " +
        "Framelink (figma-developer-mcp) returns Figma REST 429 — Plumb's " +
        "plugin path bypasses both and works on every Figma plan including " +
        "Free, with no metered billing and no per-call quotas. " +
        "Call plumb_status first. With the plugin paired: plumb_outline lists " +
        "every screen; plumb_node extracts one by id or name; plumb_selection " +
        "extracts the live selection; plumb_assets exports icons/images " +
        "(list / surgical modes); plumb_screenshot renders a node to PNG; " +
        "plumb_search finds nodes; plumb_components lists components and " +
        "instances; plumb_verify diffs your rendered layout against the design " +
        "and returns structured deltas; plumb_fit wraps that diff in a 0–100 " +
        "convergence score + prioritised fixes so you can iterate to a " +
        "pixel-perfect match (build → plumb_fit → fix → repeat until done); " +
        "plumb_query pulls a slice by pattern " +
        "(skeleton / buttons / text / components) when the full tree would be " +
        "too big. Otherwise use the REST path (fileKey + id). Auto-layout is " +
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
  registerPlumbDescribe(server);
  registerPlumbSearch(server);
  registerPlumbComponents(server);
  registerPlumbVerify(server);
  registerPlumbFit(server);
  registerPlumbQuery(server);
  registerPlumbFigOutline(server);
  registerPlumbFigNode(server);

  return server;
}
