import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { startBridge } from "./bridge/server";
import { loadEnv } from "./env";
import { runFitCli } from "./cli/fit";
import { runInit } from "./cli/init";
import { runStudioCli } from "./cli/studio";
import { runVerifyCli } from "./cli/verify";
import { SERVER_VERSION } from "./meta";
import { createServer } from "./server";

const HELP = `plumb-mcp ${SERVER_VERSION} — Figma MCP server for AI coding agents

Usage:
  plumb-mcp                  Run the stdio MCP server (+ the local plugin bridge).
                             This is what your MCP client (Claude Code, Cursor,
                             Windsurf, etc.) spawns.

  plumb-mcp init             Detect your installed editor(s) and write the
                             correct MCP config block into each — Claude Code,
                             Cursor, VS Code, Windsurf. Existing entries are
                             preserved.

  plumb-mcp verify <url>     Drive headless Chrome against your dev server,
                             capture every [data-plumb-id] element's box +
                             computed styles, and print the deltas against the
                             Figma design. No Puppeteer needed — uses your
                             installed Chrome. Run \`plumb-mcp verify --help\`
                             for the full option list.

  plumb-mcp fit <figma-url>  Self-healing build loop: generate an HTML build
                             from the design, render it, diff it, and correct
                             it pass-by-pass until it matches pixel-for-pixel.
                             Needs ANTHROPIC_API_KEY. Run \`plumb-mcp fit --help\`.

  plumb-mcp studio           Open Plumb Studio — a live local cockpit that
                             mirrors what your AI agent is doing (design, live
                             build, match score, activity) and can drive Plumb's
                             own self-healing loop with in-UI approvals.

  plumb-mcp --help, -h       Print this message and exit.
  plumb-mcp --version, -v    Print the version and exit.

Fifteen tools exposed once running: plumb_status, plumb_outline, plumb_node,
plumb_tokens, plumb_selection, plumb_assets, plumb_screenshot, plumb_describe,
plumb_search, plumb_components, plumb_verify, plumb_fit, plumb_query,
plumb_fig_outline, plumb_fig_node.

Docs:    https://tathagat22.github.io/plumb-mcp/
Source:  https://github.com/tathagat22/plumb-mcp
`;

/**
 * Bin entry for `plumb-mcp`.
 *   plumb-mcp init   → write editor MCP config, then exit
 *   plumb-mcp        → run the stdio MCP server (+ the plugin bridge)
 *
 * stdout is the JSON-RPC channel for the server once it starts, so all
 * logging once we're past arg-parsing goes to stderr.
 */
async function main(): Promise<void> {
  // Read .env before anything touches process.env (asset providers read keys
  // lazily at call time, so this only needs to run before the server starts).
  loadEnv();
  const arg = process.argv[2];

  if (arg === "--help" || arg === "-h" || arg === "help") {
    process.stdout.write(HELP);
    return;
  }
  if (arg === "--version" || arg === "-v") {
    process.stdout.write(`${SERVER_VERSION}\n`);
    return;
  }
  if (arg === "init") {
    runInit();
    return;
  }
  if (arg === "verify") {
    const code = await runVerifyCli(process.argv.slice(3));
    process.exit(code);
  }
  if (arg === "fit") {
    const code = await runFitCli(process.argv.slice(3));
    process.exit(code);
  }
  if (arg === "studio") {
    const code = await runStudioCli(process.argv.slice(3));
    process.exit(code);
  }
  if (arg && arg.startsWith("-")) {
    process.stderr.write(
      `plumb-mcp: unknown flag "${arg}". Run \`plumb-mcp --help\` for usage.\n`,
    );
    process.exit(2);
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
