import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createServer, SERVER_VERSION } from "./server";

/**
 * Bin entry for `npx plumb-mcp` — a stdio MCP server.
 * stdout is the JSON-RPC channel, so all logging goes to stderr.
 */
async function main(): Promise<void> {
  const server = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  process.stderr.write(`plumb-mcp ${SERVER_VERSION} running (stdio) — Milestone 0\n`);
}

main().catch((e: unknown) => {
  process.stderr.write(
    `plumb-mcp failed to start: ${e instanceof Error ? e.message : String(e)}\n`,
  );
  process.exit(1);
});
