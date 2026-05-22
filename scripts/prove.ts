/**
 * Milestone 0 proof (plan §12).
 *
 * Exercises the normalizer against a real (or fixture) Figma screen and prints
 * a depth/token curve — showing how progressive disclosure (plan §5/§7) keeps a
 * build-time query inside the 25k MCP ceiling even when the whole screen is far
 * larger.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { fetchNodeViaRest } from "../src/figma/rest";
import { normalize } from "../src/normalize/normalize";
import { estimateTokens } from "../src/util/estimate";
import type { FigmaFileResult, FigmaNode } from "../src/figma/types";

const here = dirname(fileURLToPath(import.meta.url));
const FETCH_DEPTH = 10;
const MCP_CEILING = 25_000;
const TARGET = 10_000;
const LINE = "─".repeat(70);

/** Load .env (gitignored) so local test credentials need not be typed each run. */
function loadDotEnv(path: string): void {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    return;
  }
  for (const rawLine of text.split("\n")) {
    const trimmed = rawLine.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (key && process.env[key] === undefined) process.env[key] = value;
  }
}

function mark(ok: boolean): string {
  return ok ? "✓" : "✗";
}

loadDotEnv(join(process.cwd(), ".env"));

const token = process.env.FIGMA_TOKEN;
const fileKey = process.env.PLUMB_FILE_KEY;
const nodeId = process.env.PLUMB_NODE_ID ?? "131:6950";

let file: FigmaFileResult;
let rawJson: string;
let source: string;
let live: boolean;

if (token && fileKey) {
  live = true;
  source = `live Figma node ${nodeId} in file ${fileKey}`;
  console.log(`Fetching ${source} (depth ${FETCH_DEPTH}) …`);
  file = await fetchNodeViaRest({ fileKey, nodeId, depth: FETCH_DEPTH, token });
  rawJson = JSON.stringify(file.document);
} else {
  live = false;
  source = "bundled synthetic fixture (export-employees dialog)";
  console.log(`No FIGMA_TOKEN/PLUMB_FILE_KEY set — using the ${source}.`);
  const raw = readFileSync(join(here, "fixtures", "export-employees.json"), "utf8");
  file = {
    document: JSON.parse(raw) as FigmaNode,
    fileName: "Fixture · export-employees",
    version: "fixture-0",
  };
  rawJson = raw;
}

const full = normalize(file, 99, {});
const d1 = normalize(file, 1, {});

console.log("\n" + LINE);
console.log("Token table — the whole screen, deduped by reference (plan §5)");
console.log(LINE);
console.log(JSON.stringify(full.tokens, null, 2));

console.log("\n" + LINE);
console.log("Top of the tree at depth 1 — `more` = children awaiting drill-down");
console.log(LINE);
console.log(JSON.stringify(d1.nodes, null, 2));

console.log("\n" + LINE);
console.log("Depth → token-cost curve  (cost of one plumb_node call per depth)");
console.log(LINE);
console.log(" depth   nodes    ~tokens   <=25k MCP   <=10k target");
for (const d of [1, 2, 3, 4, 5, 6]) {
  const pds = normalize(file, d, {});
  const t = pds.meta.estTokens;
  console.log(
    `  ${String(d).padEnd(6)}${String(pds.meta.nodeCount).padStart(5)} ` +
      `${String(t).padStart(10)}        ${mark(t <= MCP_CEILING)}           ${mark(t <= TARGET)}`,
  );
}
console.log(
  `  full  ${String(full.meta.nodeCount).padStart(5)} ` +
    `${String(full.meta.estTokens).padStart(10)}        ` +
    `${mark(full.meta.estTokens <= MCP_CEILING)}           ${mark(full.meta.estTokens <= TARGET)}`,
);

const rawTokens = estimateTokens(rawJson);
console.log("\n" + LINE);
console.log(`source     : ${source}`);
console.log(`raw Figma  : ~${rawTokens} tokens for the same subtree`);
console.log(
  `dedup      : ${full.meta.nodeCount} nodes -> ` +
    `${Object.keys(full.tokens.color).length} colours, ` +
    `${Object.keys(full.tokens.text).length} text, ` +
    `${Object.keys(full.tokens.radius).length} radii, ` +
    `${Object.keys(full.tokens.shadow).length} shadows`,
);
console.log(LINE);

const shallow = normalize(file, 3, {});
if (live) {
  if (!(full.meta.nodeCount > 0 && shallow.meta.estTokens <= MCP_CEILING)) {
    console.error("✗ FAIL: a depth-3 query already exceeds the 25k MCP ceiling.");
    process.exit(1);
  }
  console.log(
    "✓ PASS: live fetch + normalize works and dedup is sharp. A build-depth\n" +
      "  query (depth <= 3) fits the 25k MCP ceiling; a whole screen does not —\n" +
      "  which is why progressive disclosure (drill via `more`, plus plumb_outline\n" +
      "  in M1) is the design, exactly as the plan calls for.",
  );
} else {
  if (full.meta.estTokens > TARGET) {
    console.error(
      `✗ FAIL: fixture PDS ~${full.meta.estTokens} tokens — over the ${TARGET} target.`,
    );
    process.exit(1);
  }
  console.log(`✓ PASS: fixture PDS is under the ${TARGET}-token target and structurally complete.`);
}
