/**
 * `plumb-mcp studio` — open the live Plumb Studio cockpit in your browser.
 *
 * The MCP server your editor spawned is already serving Studio on a loopback
 * bridge port. This probes the range for the live one and opens it. Run it in
 * a separate terminal while your agent works.
 */
import { spawn } from "node:child_process";
import { BRIDGE_PORTS } from "../bridge/protocol";

const HELP = `plumb-mcp studio — open the live Plumb Studio cockpit

Usage:
  plumb-mcp studio            Find the running Plumb server and open Studio in your browser.
  plumb-mcp studio --print    Just print the URL (don't open a browser).

Studio mirrors what your AI agent is doing — the design, the live build, the
climbing match score, and the activity timeline — and can also drive Plumb's
own self-healing loop with in-UI approvals.
`;

/** First loopback bridge port that answers — that's the live Plumb server. */
async function findRunningPort(): Promise<number | null> {
  for (const port of BRIDGE_PORTS) {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 500);
      await fetch(`http://127.0.0.1:${port}/`, { signal: ctrl.signal });
      clearTimeout(timer);
      return port; // any HTTP response means a server is listening
    } catch {
      /* not this port — try the next */
    }
  }
  return null;
}

function openBrowser(url: string): void {
  const platform = process.platform;
  const [cmd, args] =
    platform === "darwin"
      ? ["open", [url]]
      : platform === "win32"
        ? ["cmd", ["/c", "start", "", url]]
        : ["xdg-open", [url]];
  try {
    spawn(cmd as string, args as string[], { stdio: "ignore", detached: true }).unref();
  } catch {
    /* best-effort — the URL is printed regardless */
  }
}

export async function runStudioCli(argv: string[]): Promise<number> {
  if (argv.includes("-h") || argv.includes("--help")) {
    process.stdout.write(HELP);
    return 0;
  }
  const port = await findRunningPort();
  if (!port) {
    process.stderr.write(
      `plumb-mcp studio: no running Plumb server found on 127.0.0.1 (ports ${BRIDGE_PORTS[0]}–${BRIDGE_PORTS[BRIDGE_PORTS.length - 1]}).\n` +
        "Start your MCP client (Claude Code / Cursor / Windsurf) so it launches plumb-mcp, then re-run this.\n",
    );
    return 1;
  }
  const url = `http://127.0.0.1:${port}/`;
  process.stdout.write(`Plumb Studio → ${url}\n`);
  if (!argv.includes("--print")) openBrowser(url);
  return 0;
}
