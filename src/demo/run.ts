/**
 * `plumb-mcp demo` / `npm run demo` — the whole product, offline, in one command.
 *
 * A buyer, a reviewer, or a teammate evaluating Plumb should not have to
 * install a Figma plugin, mint a token, and find a design file before they can
 * tell whether any of this works. This runs the real comparison engine over a
 * real PDS with a known set of planted mistakes and prints what it found: no
 * network, no browser, no credentials, and no mocking of the code under test.
 *
 * The numbers it prints are the same ones `src/demo/demo.test.ts` asserts, so
 * the demo cannot drift away from the truth without failing CI.
 */
import { PRICING_PDS } from "./fixture";
import { FAULTS } from "./faults";
import { runScenario, type Round } from "./scenario";
import type { Delta } from "../verify";

const HELP = `plumb-mcp demo — run the design→code→verify loop offline

Usage:
  plumb-mcp demo            Run the scored walkthrough and print the report.
  plumb-mcp demo --json     Emit the same results as JSON (for CI / scripting).
                            Exit code is 0 only if every planted fault was
                            caught and none were invented. From npm, use
                            \`npm run --silent demo -- --json\` so npm's own
                            banner stays out of the JSON.
  plumb-mcp demo --pds      Print the design spec the demo runs against.

No Figma token, no plugin, no browser, no network. The engine that scores the
demo is the same one behind plumb_verify and plumb_fit.
`;

/* ---------------------------------------------------------------- colour -- */

const ESC = "\u001b[";

const useColor =
  process.stdout.isTTY === true && !process.env.NO_COLOR && process.env.TERM !== "dumb";

const paint =
  (code: string) =>
  (s: string): string =>
    useColor ? `${ESC}${code}m${s}${ESC}0m` : s;

const dim = paint("2");
const bold = paint("1");
const red = paint("31");
const green = paint("32");
const yellow = paint("33");
const cyan = paint("36");

/* ---------------------------------------------------------- formatting --- */

function pad(s: string, width: number): string {
  return s.length >= width ? s : s + " ".repeat(width - s.length);
}

function fmtVal(v: string | number | null): string {
  if (v === null) return "—";
  return String(v);
}

/** The `el` half of an `"<el>:<kind>"` expectation key. */
function elOf(key: string): string {
  return key.slice(0, key.lastIndexOf(":"));
}

/** One delta as a single aligned line. */
function deltaLine(d: Delta): string {
  const tint = d.severity === "error" ? red : d.severity === "warn" ? yellow : dim;
  return (
    `      ${dim(pad(d.el, 20))}${tint(pad(d.kind, 18))}` +
    `expected ${bold(fmtVal(d.expected))}  ·  got ${bold(fmtVal(d.actual))}`
  );
}

function scoreColor(score: number): (s: string) => string {
  if (score >= 98) return green;
  if (score >= 80) return yellow;
  return red;
}

function printRound(round: Round): void {
  const { fit } = round;
  const tint = scoreColor(fit.score);
  const built = `${fit.importantMatched}/${fit.importantTotal} key nodes built`;

  process.stdout.write(`\n  ${bold(`Round ${round.index}`)} ${dim("· " + round.action)}\n`);
  process.stdout.write(
    `    ${tint(fit.bar)}  ${tint(bold(`${fit.score.toFixed(1)}%`))}` +
      `${dim("   " + [`${fit.errors} errors`, `${fit.warns} warnings`, built].join(" · "))}\n\n`,
  );

  if (!round.outcomes.length) {
    process.stdout.write(`    ${green("✓")} Nothing left to fix — the build matches the design.\n`);
    return;
  }

  for (const outcome of round.outcomes) {
    const mark = outcome.detected ? green("✓") : red("✗ MISSED");
    process.stdout.write(`    ${mark} ${outcome.fault.label}\n`);
    if (outcome.deltas.length) {
      for (const d of outcome.deltas.slice(0, 4)) process.stdout.write(deltaLine(d) + "\n");
      if (outcome.deltas.length > 4) {
        process.stdout.write(dim(`      … ${outcome.deltas.length - 4} more on the same node\n`));
      }
    } else {
      // A node that was never built produces no delta at all — only a coverage
      // hole. Spelling that out is the point: a delta-only report would call
      // this build clean.
      for (const key of outcome.fault.expect) {
        process.stdout.write(
          `      ${dim(pad(elOf(key), 20))}${red(pad("not built", 18))}` +
            dim("no data-plumb-id for this handle in the DOM") +
            "\n",
        );
      }
    }
  }
}

/* --------------------------------------------------------------- report -- */

export interface DemoSummary {
  planted: number;
  caught: number;
  missed: number;
  falsePositives: number;
  untouchedNodes: number;
  scores: number[];
  passed: boolean;
}

export function summarize(rounds: Round[]): DemoSummary {
  const first = rounds[0];
  const planted = first?.outcomes.length ?? 0;
  const caught = first?.detected ?? 0;
  const touched = new Set((first?.outcomes ?? []).flatMap((o) => o.fault.expect.map(elOf)));
  const falsePositives = rounds.reduce((n, r) => n + r.falsePositives.length, 0);
  return {
    planted,
    caught,
    missed: planted - caught,
    falsePositives,
    untouchedNodes: Object.keys(PRICING_PDS.nodes).length - touched.size,
    scores: rounds.map((r) => r.fit.score),
    passed:
      planted > 0 &&
      caught === planted &&
      falsePositives === 0 &&
      (rounds.at(-1)?.fit.done ?? false),
  };
}

function printHeader(): void {
  const { tokens, nodes, file, meta, root } = PRICING_PDS;
  process.stdout.write(
    `\n  ${bold(cyan("PLUMB"))} ${dim("— design → code → verify, running entirely offline")}\n\n`,
  );
  process.stdout.write(
    `  ${dim(pad("Design", 12))}${file.name} › ${bold("Pricing")}` +
      dim(`  (Figma frame ${nodes[root]?.id ?? "?"})\n`),
  );
  process.stdout.write(
    `  ${dim(pad("Spec", 12))}${Object.keys(nodes).length} nodes · ` +
      `${Object.keys(tokens.color).length} colour · ${Object.keys(tokens.text).length} type · ` +
      `${Object.keys(tokens.radius).length} radius tokens ` +
      dim(`(~${meta.estTokens} tokens of context)\n`),
  );
  process.stdout.write(
    `  ${dim(pad("Build", 12))}the same screen rebuilt by an agent, with ` +
      `${bold(String(FAULTS.length))} planted mistakes\n`,
  );
  process.stdout.write(
    `  ${dim(pad("Needs", 12))}${dim("no Figma token · no plugin · no browser · no network")}\n`,
  );
}

function printSummary(s: DemoSummary): void {
  const recall = s.planted ? Math.round((s.caught / s.planted) * 100) : 0;
  const arrow = s.scores.map((n) => n.toFixed(1) + "%").join(dim(" → "));

  process.stdout.write(`\n  ${bold("Scoreboard")}\n`);
  process.stdout.write(`    ${dim(pad("Mistakes planted", 22))}${bold(String(s.planted))}\n`);
  process.stdout.write(
    `    ${dim(pad("Caught", 22))}` +
      `${(s.caught === s.planted ? green : red)(bold(String(s.caught)))}` +
      dim(`   (${recall}% recall)\n`),
  );
  process.stdout.write(
    `    ${dim(pad("False positives", 22))}` +
      `${(s.falsePositives === 0 ? green : red)(bold(String(s.falsePositives)))}` +
      dim(`   across ${s.untouchedNodes} untouched nodes\n`),
  );
  process.stdout.write(`    ${dim(pad("Convergence", 22))}${arrow}\n`);

  process.stdout.write(
    s.passed
      ? `\n  ${green("✓")} Every planted mistake was found, nothing was invented, and the loop\n` +
          `    converged to a pixel-perfect match.\n`
      : `\n  ${red("✗")} The demo did not meet its own claim — see the misses above.\n`,
  );
  process.stdout.write(
    dim(
      `\n  This is the loop your agent runs against a real Figma file: extract the spec,\n` +
        `  build, score the build, fix what the score points at, repeat until it is 100.\n` +
        `  Point it at your own design with `,
    ) +
      bold("plumb-mcp init") +
      dim(".\n\n"),
  );
}

/* ------------------------------------------------------------------ cli -- */

export async function runDemoCli(argv: string[]): Promise<number> {
  if (argv.includes("-h") || argv.includes("--help")) {
    process.stdout.write(HELP);
    return 0;
  }
  if (argv.includes("--pds")) {
    process.stdout.write(JSON.stringify(PRICING_PDS, null, 2) + "\n");
    return 0;
  }

  const rounds = runScenario();
  const summary = summarize(rounds);

  if (argv.includes("--json")) {
    process.stdout.write(
      JSON.stringify(
        {
          summary,
          rounds: rounds.map((r) => ({
            index: r.index,
            action: r.action,
            score: r.fit.score,
            errors: r.fit.errors,
            warns: r.fit.warns,
            detected: r.detected,
            missed: r.missed,
            falsePositives: r.falsePositives.length,
            faults: r.outcomes.map((o) => ({
              id: o.fault.id,
              label: o.fault.label,
              detected: o.detected,
              missed: o.missed,
            })),
          })),
        },
        null,
        2,
      ) + "\n",
    );
    return summary.passed ? 0 : 1;
  }

  printHeader();
  for (const round of rounds) printRound(round);
  printSummary(summary);
  return summary.passed ? 0 : 1;
}
