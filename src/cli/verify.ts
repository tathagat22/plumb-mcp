/**
 * `plumb-mcp verify <url>` — the missing "I shouldn't have to write 110 lines
 * of CDP harness just to run plumb_verify" piece. Spawns the user's existing
 * Chrome, navigates to the dev URL, scrapes every [data-plumb-id] element's
 * box + computed styles + text, runs the same `verifyAgainst()` engine the
 * MCP tool uses, and prints a delta table.
 *
 * Everything here is best-effort and reports clearly on failure — Chrome
 * missing, target page didn't load, no tagged elements, etc.
 */
import { existsSync, readFileSync } from "node:fs";
import { chromeInstallHint, findChrome } from "./chrome";
import { launchBrowser } from "./cdp";
import { captureRendered } from "../render/capture";
import { fetchNodeViaRest } from "../figma/rest";
import { resolveFigmaTarget } from "../figma/url";
import { normalizeToBudget } from "../normalize/budget";
import {
  DEFAULT_TOLERANCES,
  verifyAgainst,
  type Delta,
  type RenderedElement,
  type VerifyResult,
} from "../verify";

interface CliArgs {
  url?: string;
  node?: string;
  name?: string;
  fileKey?: string;
  figmaUrl?: string;
  chrome?: string;
  selector: string;
  waitMs: number;
  depth: number;
  verbose: boolean;
  json: boolean;
  showHelp: boolean;
}

const HELP = `plumb-mcp verify — diff your rendered UI against the Figma design

Usage:
  plumb-mcp verify <url> --node <figma-node-id>
  plumb-mcp verify <url> --url <figma-url>

Arguments:
  <url>                     Your running dev server URL (e.g. http://localhost:5173/dashboard)

Required (one of):
  --node <id>               Figma node id (e.g. 190:109884)
  --url <figma-url>         Paste a Figma URL — fileKey + node are auto-extracted
  --name <name>             Screen name (with --file)

Common options:
  --file <fileKey>          Figma file key (defaults from --url or env)
  --depth <n>               PDS depth (default 12 — deep enough for most screens)
  --selector <css>          Capture elements matching this selector
                            (default "[data-plumb-id]")
  --wait <ms>               Wait this long after page load before capturing (default 1500)
  --chrome <path>           Explicit Chrome binary path
  --json                    Print machine-readable JSON instead of the table
  --verbose                 Tee Chrome stderr to ours (debug aid)
  -h, --help                Show this message

Environment:
  FIGMA_TOKEN               Required — same token plumb-mcp uses for REST.
  PLUMB_CHROME / CHROME_PATH  Override Chrome binary path.

Example:
  plumb-mcp verify http://localhost:5173/dashboard --node 190:109884
`;

function parseArgs(argv: string[]): CliArgs {
  const out: CliArgs = {
    selector: "[data-plumb-id]",
    waitMs: 1500,
    depth: 12,
    verbose: false,
    json: false,
    showHelp: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "-h" || a === "--help") out.showHelp = true;
    else if (a === "--verbose") out.verbose = true;
    else if (a === "--json") out.json = true;
    else if (a === "--node") out.node = argv[++i];
    else if (a === "--name") out.name = argv[++i];
    else if (a === "--file") out.fileKey = argv[++i];
    else if (a === "--url") out.figmaUrl = argv[++i];
    else if (a === "--chrome") out.chrome = argv[++i];
    else if (a === "--selector") out.selector = argv[++i] ?? out.selector;
    else if (a === "--wait") out.waitMs = Number(argv[++i] ?? 1500);
    else if (a === "--depth") out.depth = Number(argv[++i] ?? 12);
    else if (a.startsWith("-")) throw new Error(`Unknown flag "${a}". Run \`plumb-mcp verify --help\` for usage.`);
    else if (!out.url) out.url = a;
    else throw new Error(`Unexpected positional argument "${a}".`);
  }
  return out;
}

function requireToken(): string {
  const t = process.env.FIGMA_TOKEN ?? process.env.FIGMA_ACCESS_TOKEN;
  if (!t) {
    throw new Error(
      "FIGMA_TOKEN is not set. Create a read-only token at " +
        "figma.com → Settings → Security → personal access tokens, then export it.",
    );
  }
  return t;
}

function colorize(s: string, code: string): string {
  if (!process.stdout.isTTY) return s;
  return `[${code}m${s}[0m`;
}

function severityIcon(sev: string): string {
  if (sev === "error") return colorize("✗", "31");
  if (sev === "warn") return colorize("!", "33");
  return colorize("·", "90");
}

function printTable(result: VerifyResult, pageUrl: string, screen: string | null): void {
  const cov = result.coverage;
  const pct = cov ? Math.round(cov.coverage * 100) : 100;
  const matchedLine = `${result.matched}/${cov?.pdsTotal ?? result.matched}`;
  const status = result.ok ? colorize("OK", "32") : colorize("FAIL", "31");
  process.stdout.write(`\nplumb verify · ${status}\n`);
  process.stdout.write(`  page    ${pageUrl}\n`);
  if (screen) process.stdout.write(`  screen  ${screen}\n`);
  process.stdout.write(`  matched ${matchedLine} (${pct}% coverage)\n`);
  process.stdout.write(`  deltas  ${result.deltas.length} (${countBy(result.deltas, "error")} errors, ${countBy(result.deltas, "warn")} warns)\n`);
  if (result.deltas.length) {
    process.stdout.write("\n");
    for (const d of result.deltas.slice(0, 60)) {
      process.stdout.write(
        `  ${severityIcon(d.severity)} ${d.el} · ${d.kind} — expected ${fmtVal(d.expected)}, actual ${fmtVal(d.actual)}\n`,
      );
    }
    if (result.deltas.length > 60) {
      process.stdout.write(`  … and ${result.deltas.length - 60} more (re-run with --json for the full list)\n`);
    }
  }
  if (cov && cov.untagged.length) {
    process.stdout.write("\nUntagged but visible in the PDS subtree — consider tagging next round:\n");
    process.stdout.write("  " + cov.untagged.slice(0, 12).join(", "));
    if (cov.untagged.length > 12) process.stdout.write(`, … +${cov.untagged.length - 12}`);
    process.stdout.write("\n");
  }
  process.stdout.write("\n");
}

function countBy(deltas: Delta[], sev: string): number {
  return deltas.filter((d) => d.severity === sev).length;
}

function fmtVal(v: string | number | null): string {
  if (v === null) return "—";
  return typeof v === "string" ? `"${v}"` : String(v);
}

/** Try to pick up package.json next to the bin to print a useful version. */
function readSelfVersion(): string {
  try {
    const pkg = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8")) as { version?: string };
    return pkg.version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
}

export async function runVerifyCli(argv: string[]): Promise<number> {
  let args: CliArgs;
  try {
    args = parseArgs(argv);
  } catch (e) {
    process.stderr.write(`plumb-mcp verify: ${(e as Error).message}\n`);
    return 2;
  }
  if (args.showHelp) {
    process.stdout.write(HELP);
    return 0;
  }
  if (!args.url) {
    process.stderr.write("plumb-mcp verify: missing <url>. Run `plumb-mcp verify --help`.\n");
    return 2;
  }

  // Resolve the Figma target.
  let fileKey: string | undefined;
  let nodeId: string | undefined;
  try {
    const t = resolveFigmaTarget({
      url: args.figmaUrl,
      fileKey: args.fileKey,
      id: args.node,
    });
    fileKey = t.fileKey;
    nodeId = t.id;
  } catch (e) {
    process.stderr.write(`plumb-mcp verify: ${(e as Error).message}\n`);
    return 2;
  }
  if (!fileKey || !nodeId) {
    process.stderr.write(
      "plumb-mcp verify needs a Figma node — pass --node <id> (with --file), --url <figma-url>, or set FIGMA_FILE_KEY.\n",
    );
    return 2;
  }

  // Find Chrome before doing anything expensive.
  const chromePath = findChrome(args.chrome);
  if (!chromePath) {
    process.stderr.write(chromeInstallHint() + "\n");
    return 3;
  }
  if (!existsSync(chromePath)) {
    process.stderr.write(`Chrome path "${chromePath}" does not exist.\n`);
    return 3;
  }

  // Fetch the PDS via REST.
  let token: string;
  try {
    token = requireToken();
  } catch (e) {
    process.stderr.write(`plumb-mcp verify: ${(e as Error).message}\n`);
    return 4;
  }
  process.stderr.write(`[1/3] Fetching PDS for ${fileKey}:${nodeId}…\n`);
  const file = await fetchNodeViaRest({
    fileKey,
    nodeId,
    depth: args.depth + 1,
    token,
  });
  const pds = normalizeToBudget(file, args.depth, undefined, { notes: false });

  // Drive Chrome.
  process.stderr.write(`[2/3] Launching ${chromePath.split("/").pop()}…\n`);
  const browser = await launchBrowser({ chromePath, verbose: args.verbose });
  let rendered: RenderedElement[];
  try {
    process.stderr.write(`[3/3] Capturing ${args.selector} on ${args.url}…\n`);
    rendered = await captureRendered(browser, args.url, args.selector, args.waitMs);
  } finally {
    await browser.close();
  }
  if (rendered.length === 0) {
    process.stderr.write(
      `\nNo elements matched ${args.selector} on ${args.url}. ` +
        "Tag your rendered elements with data-plumb-id=\"<el>\" or pass --selector to override.\n",
    );
    return 5;
  }

  const result = verifyAgainst(pds, rendered, DEFAULT_TOLERANCES);
  if (args.json) {
    process.stdout.write(JSON.stringify(result, null, 2) + "\n");
  } else {
    printTable(result, args.url, file.document.name ?? null);
  }
  return result.ok ? 0 : 1;
}

export const VERIFY_CLI_VERSION = readSelfVersion();
