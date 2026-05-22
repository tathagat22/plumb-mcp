import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerPlumbNode } from "./tools/node";

export const SERVER_NAME = "plumb-mcp";
export const SERVER_VERSION = "0.0.1";

/** Builds the Plumb MCP server with all tools registered. */
export function createServer(): McpServer {
  const server = new McpServer(
    { name: SERVER_NAME, version: SERVER_VERSION },
    {
      instructions:
        "Plumb extracts Figma designs as compact, normalized specs for building " +
        "UI. When you are given a Figma file/frame to implement, call plumb_node " +
        "with the file key and node id — it returns deduplicated design tokens " +
        "and a CSS-shaped node tree (auto-layout already resolved to flexbox).",
    },
  );

  registerPlumbNode(server);

  return server;
}
