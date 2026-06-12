/**
 * `plumb-mcp fit <figma-url>` — the autonomous self-healing loop.
 *
 * Extract the PDS → generate a self-contained HTML document → render it
 * headless in your installed Chrome → diff the rendered DOM against the design
 * → feed the deltas back and regenerate → repeat until the convergence score
 * clears the acceptance bar (or the iteration cap). Writes the final document
 * to disk and prints the climbing score per pass.
 *
 * Two BYO keys: FIGMA_TOKEN (read the design) and ANTHROPIC_API_KEY (generate).
 * No Puppeteer; uses the same CDP harness as `plumb-mcp verify`.
 */
import { existsSync, writeFileSync } from "node:fs";
import { resolve as resolvePath } from "node:path";
import { chromeInstallHint, findChrome } from "./chrome";
import { launchBrowser } from "./cdp";
import { DEFAULT_ACCEPT, buildFitResponse } from "../fit";
import { DEFAULT_FIT_MODEL, generateHtml } from "../fit/generate";
import { serveHtml } from "../fit/serve";
import { fetchNodeViaRest } from "../figma/rest";
import { resolveFigmaTarget } from "../figma/url";
import { normalizeToBudget } from "../normalize/budget";
import { captureRendered } from "../render/capture";
import { DEFAULT_TOLERANCES, verifyAgainst } from "../verify";
import type { Delta } from "../verify";

interface FitArgs {
  url?: string;
  node?: string;
  fileKey?: string;
  figmaUrl?: string;
  chrome?: string;
  model: string;
  iters: number;
  accept: number;
  out: string;
  waitMs: number;
  depth: number;
  verbose: boolean;
  json: boolean;
  showHelp: boolean;
}

const HELP = `plumb-mcp fit — generate a pixel-matching build and self-correct it against Figma

Usage:
  plumb-mcp fit <figma-url>
  plumb-mcp fit --node <id> --file <fileKey>

Arguments:
  <figma-url>               A Figma URL — fileKey + node are auto-extracted.

Options:
  --node <id>               Figma node id (with --file) instead of a URL.
  --file <fileKey>          Figma file key.
  --model <id>              Generator model. Default ${DEFAULT_FIT_MODEL}. Try an Opus id for max fidelity.
  --iters <n>               Max correction passes. Default 5.
  --accept <0-100>          Stop once the score clears this. Default ${DEFAULT_ACCEPT}.
  --out <path>              Where to write the final HTML. Default ./plumb-fit.html
  --depth <n>               PDS depth. Default 12.
  --wait <ms>               Settle time after each render. Default 1200.
  --chrome <path>           Explicit Chrome binary path.
  --json                    Print the machine-readable run summary.
  --verbose                 Tee Chrome stderr (debug aid).
  -h, --help                Show this message.

Environment:
  FIGMA_TOKEN               Read-only Figma token (figma.com → Settings → Security).
  ANTHROPIC_API_KEY         Key for the generator model.
  PLUMB_FIT_MODEL           Default model override.
  PLUMB_CHROME / CHROME_PATH  Chrome binary override.

Example:
  plumb-mcp fit https://www.figma.com/design/abc/Flow?node-id=190-109884
`;

function parseArgs(argv: string[]): FitArgs {
  const out: FitArgs = {
    model: process.env.PLUMB_FIT_MODEL ?? DEFAULT_FIT_MODEL,
    iters: 5,
    accept: DEFAULT_ACCEPT,
    out: "plumb-fit.html",
    waitMs: 1200,
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
    else if (a === "--file") out.fileKey = argv[++i];
    else if (a === "--model") out.model = argv[++i] ?? out.model;
    else if (a === "--out") out.out = argv[++i] ?? out.out;
    else if (a === "--iters") out.iters = Number(argv[++i] ?? out.iters);
    else if (a === "--accept") out.accept = Number(argv[++i] ?? out.accept);
    else if (a === "--depth") out.depth = Number(argv[++i] ?? out.depth);
    else if (a === "--wait") out.waitMs = Number(argv[++i] ?? out.waitMs);
    else if (a === "--chrome") out.chrome = argv[++i];
    else if (a.startsWith("-"))
      throw new Error(`Unknown flag "${a}". Run \`plumb-mcp fit --help\` for usage.`);
    else if (!out.url) out.url = a;
    else throw new Error(`Unexpected positional argument "${a}".`);
  }
  // A bare URL passed positionally is also the Figma URL.
  if (out.url && !out.figmaUrl) out.figmaUrl = out.url;
  return out;
}

function colorize(s: string, code: string): string {
  if (!process.stdout.isTTY) return s;
  return `\x1b[${code}m${s}\x1b[0m`;
}

function bar10(score: number): string {
  const filled = Math.round((Math.max(0, Math.min(100, score)) / 100) * 10);
  return "▰".repeat(filled) + "▱".repeat(10 - filled);
}

interface PassRecord {
  iteration: number;
  score: number;
  done: boolean;
  errors: number;
  warns: number;
  matched: number;
  importantTotal: number;
}

export async function runFitCli(argv: string[]): Promise<number> {
  let args: FitArgs;
  try {
    args = parseArgs(argv);
  } catch (e) {
    process.stderr.write(`plumb-mcp fit: ${(e as Error).message}\n`);
    return 2;
  }
  if (args.showHelp) {
    process.stdout.write(HELP);
    return 0;
  }

  // Resolve the Figma target.
  let fileKey: string | undefined;
  let nodeId: string | undefined;
  try {
    const t = resolveFigmaTarget({ url: args.figmaUrl, fileKey: args.fileKey, id: args.node });
    fileKey = t.fileKey;
    nodeId = t.id;
  } catch (e) {
    process.stderr.write(`plumb-mcp fit: ${(e as Error).message}\n`);
    return 2;
  }
  if (!fileKey || !nodeId) {
    process.stderr.write(
      "plumb-mcp fit needs a Figma node — pass a Figma URL, or --node <id> with --file <fileKey>.\n",
    );
    return 2;
  }

  // Keys.
  const figmaToken = process.env.FIGMA_TOKEN ?? process.env.FIGMA_ACCESS_TOKEN;
  if (!figmaToken) {
    process.stderr.write(
      "plumb-mcp fit: FIGMA_TOKEN is not set (figma.com → Settings → Security → personal access tokens).\n",
    );
    return 4;
  }
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    process.stderr.write(
      "plumb-mcp fit: ANTHROPIC_API_KEY is not set — needed to generate the build. Export it and retry.\n",
    );
    return 4;
  }

  // Chrome.
  const chromePath = findChrome(args.chrome);
  if (!chromePath || !existsSync(chromePath)) {
    process.stderr.write((chromePath ? `Chrome path "${chromePath}" does not exist.` : chromeInstallHint()) + "\n");
    return 3;
  }

  // PDS.
  process.stderr.write(`[plumb fit] Fetching PDS for ${fileKey}:${nodeId}…\n`);
  const file = await fetchNodeViaRest({ fileKey, nodeId, depth: args.depth + 1, token: figmaToken });
  const pds = normalizeToBudget(file, args.depth, undefined, { notes: false });
  const screen = file.document.name ?? nodeId;

  const browser = await launchBrowser({ chromePath, verbose: args.verbose });
  const passes: PassRecord[] = [];
  let prevHtml: string | undefined;
  let deltas: Delta[] | undefined;
  let finalHtml = "";
  let finalScore = 0;
  let done = false;

  try {
    if (!args.json) {
      process.stderr.write(`[plumb fit] ${screen} — up to ${args.iters} pass(es), accept ≥ ${args.accept}%\n\n`);
    }
    for (let i = 1; i <= args.iters; i++) {
      const html = await generateHtml({ pds, prevHtml, deltas, model: args.model, apiKey });
      finalHtml = html;

      const served = await serveHtml(html);
      let rendered;
      try {
        rendered = await captureRendered(browser, served.url, "[data-plumb-id]", args.waitMs);
      } finally {
        await served.close();
      }

      const result = verifyAgainst(pds, rendered, DEFAULT_TOLERANCES);
      const fit = buildFitResponse(result, { accept: args.accept, iteration: i });
      finalScore = fit.score;
      done = fit.done;
      passes.push({
        iteration: i,
        score: fit.score,
        done: fit.done,
        errors: fit.errors,
        warns: fit.warns,
        matched: fit.matched,
        importantTotal: fit.importantTotal,
      });

      if (!args.json) {
        const pct = `${fit.score.toFixed(1)}%`.padStart(6);
        const status = fit.done ? colorize("✓", "32") : " ";
        process.stderr.write(
          `  iter ${i}  ${pct}  ${bar10(fit.score)}  ${status}  ` +
            `${fit.errors} err · ${fit.warns} warn · ${fit.importantMatched}/${fit.importantTotal} key nodes\n`,
        );
      }

      prevHtml = html;
      deltas = result.deltas;
      if (fit.done) break;
    }
  } finally {
    await browser.close();
  }

  // Write the final document.
  const outPath = resolvePath(process.cwd(), args.out);
  writeFileSync(outPath, finalHtml, "utf8");

  if (args.json) {
    process.stdout.write(
      JSON.stringify({ screen, fileKey, nodeId, accept: args.accept, model: args.model, done, finalScore, out: outPath, passes }, null, 2) + "\n",
    );
  } else {
    const verdict = done
      ? colorize(`Pixel-perfect — ${finalScore.toFixed(1)}%`, "32")
      : colorize(`Stopped at ${finalScore.toFixed(1)}% after ${passes.length} pass(es)`, "33");
    process.stderr.write(`\n[plumb fit] ${verdict}\n`);
    process.stderr.write(`[plumb fit] Wrote ${outPath}\n`);
    if (!done) {
      process.stderr.write(`[plumb fit] Raise --iters or inspect the file; the design may have nodes the generator can't infer (assets, custom fonts).\n`);
    }
  }
  return done ? 0 : 1;
}
