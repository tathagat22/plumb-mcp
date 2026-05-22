import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { startBridge } from "./bridge/server";
import { runInit } from "./cli/init";
import { SERVER_VERSION } from "./meta";
import { createServer } from "./server";

/**
 * Bin entry for `plumb-mcp`.
 *   plumb-mcp init   → write editor MCP config, then exit
 *   plumb-mcp        → run the stdio MCP server (+ the plugin bridge)
 *
 * stdout is the JSON-RPC channel for the server, so all logging goes to stderr.
 */
async function main(): Promise<void> {
  if (process.argv[2] === "init") {
    runInit();
    return;
  }

  const server = createServer();
  // Best-effort: start the plugin bridge. The REST path works without it.
  await startBridge();

  const transport = new StdioServerTransport();
  await server.connect(transport);
  process.stderr.write(`plumb-mcp ${SERVER_VERSION} running (stdio)\n`);
}

main().catch((e: unknown) => {
  process.stderr.write(
    `plumb-mcp failed to start: ${e instanceof Error ? e.message : String(e)}\n`,
  );
  process.exit(1);
});
