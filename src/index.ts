import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { startBridge } from "./bridge/server";
import { closeAllBrowsers } from "./cli/cdp";
import { loadEnv } from "./env";
import { createLogger } from "./logger";
import { runDemoCli } from "./demo/run";
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

  plumb-mcp demo             Run the whole design→code→verify loop offline on a
                             bundled design: no Figma token, no plugin, no
                             browser, no network. Prints what the engine caught
                             and the score climbing to 100. Start here.

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

const log = createLogger("plumb-mcp");

/** Normalise a thrown value so the logger can serialise message + stack. */
function asError(e: unknown): Error {
  return e instanceof Error ? e : new Error(String(e));
}

/**
 * The bridge is a shared process — potentially serving several concurrent
 * MCP client sessions at once (multi-agent pairing, see docs/architecture.md).
 * A single malformed message or a stray exception in any one tool call must
 * not take the whole process down and orphan every other session. Node's
 * default behavior for both events is to crash, so log-and-continue is a
 * deliberate override, not an oversight.
 */
function installProcessGuards(): void {
  process.on("uncaughtException", (e: unknown) => {
    log.error("uncaught exception — server stays up", { err: asError(e) });
  });
  process.on("unhandledRejection", (e: unknown) => {
    log.error("unhandled rejection — server stays up", { err: asError(e) });
  });

  // A killed/restarted MCP host (editor reload, host crash) must not leave a
  // headless Chrome process running — plumb_verify/plumb_fit/plumb_import_web
  // can each have one open at shutdown time.
  let shuttingDown = false;
  const shutdown = (signal: NodeJS.Signals) => {
    if (shuttingDown) return;
    shuttingDown = true;
    log.info("shutting down — closing any open browsers", { signal });
    closeAllBrowsers().finally(() => process.exit(0));
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

/**
 * Bin entry for `plumb-mcp`.
 *   plumb-mcp init   → write editor MCP config, then exit
 *   plumb-mcp        → run the stdio MCP server (+ the plugin bridge)
 *
 * stdout is the JSON-RPC channel for the server once it starts, so all
 * logging once we're past arg-parsing goes to stderr.
 */
async function main(): Promise<void> {
  installProcessGuards();
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
  if (arg === "demo") {
    const code = await runDemoCli(process.argv.slice(3));
    process.exit(code);
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
  log.info("running", { version: SERVER_VERSION, transport: "stdio" });
}

main().catch((e: unknown) => {
  log.error("failed to start", { err: asError(e) });
  process.exit(1);
});
