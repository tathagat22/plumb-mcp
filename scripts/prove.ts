/**
 * Milestone 0 proof (plan §12 / §11).
 *
 * Runs the normalizer and shows that a real screen lands as a compact,
 * structurally-complete PDS. With FIGMA_TOKEN + PLUMB_FILE_KEY set it proves
 * against the live export-employees frame; otherwise it falls back to the
 * bundled synthetic fixture so the normalizer is still exercised end-to-end.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { fetchNodeViaRest } from "../src/figma/rest";
import { normalize } from "../src/normalize/normalize";
import { estimateTokens } from "../src/util/estimate";
import type { FigmaFileResult, FigmaNode } from "../src/figma/types";

const here = dirname(fileURLToPath(import.meta.url));
const DEPTH = 8;
const BUDGET = 10_000;

const token = process.env.FIGMA_TOKEN;
const fileKey = process.env.PLUMB_FILE_KEY;
const nodeId = process.env.PLUMB_NODE_ID ?? "131:6950";

let file: FigmaFileResult;
let rawJson: string;
let source: string;

if (token && fileKey) {
  source = `live Figma node ${nodeId} in file ${fileKey}`;
  console.log(`Fetching ${source} …`);
  file = await fetchNodeViaRest({ fileKey, nodeId, depth: DEPTH, token });
  rawJson = JSON.stringify(file.document);
} else {
  source = "bundled synthetic fixture (export-employees dialog)";
  console.log("No FIGMA_TOKEN/PLUMB_FILE_KEY set — using the " + source + ".");
  console.log("Prove against the real frame with:");
  console.log("  FIGMA_TOKEN=figd_xxx PLUMB_FILE_KEY=<file-key> npm run prove\n");
  const raw = readFileSync(join(here, "fixtures", "export-employees.json"), "utf8");
  file = {
    document: JSON.parse(raw) as FigmaNode,
    fileName: "Fixture · export-employees",
    version: "fixture-0",
  };
  rawJson = raw;
}

const pds = normalize(file, DEPTH, {});
const pdsJson = JSON.stringify(pds);

const rawTokens = estimateTokens(rawJson);
const pdsTokens = estimateTokens(pdsJson);
const reduction = (rawTokens / Math.max(pdsTokens, 1)).toFixed(1);

const line = "─".repeat(64);
console.log(line);
console.log("Plumb · Milestone 0 proof — normalizer output (PDS)");
console.log(line);
console.log(JSON.stringify(pds, null, 2));
console.log(line);
console.log(`source         : ${source}`);
console.log(`raw Figma JSON : ~${rawTokens} tokens`);
console.log(`Plumb PDS      : ~${pdsTokens} tokens   (meta.estTokens=${pds.meta.estTokens})`);
console.log(`reduction      : ${reduction}×`);
console.log(`nodes          : ${pds.meta.nodeCount}`);
console.log(
  `token table    : ${Object.keys(pds.tokens.color).length} colors, ` +
    `${Object.keys(pds.tokens.text).length} text, ` +
    `${Object.keys(pds.tokens.radius).length} radii, ` +
    `${Object.keys(pds.tokens.shadow).length} shadows`,
);
console.log(line);

if (pdsTokens > BUDGET) {
  console.error(`✗ FAIL: PDS is ~${pdsTokens} tokens — over the ${BUDGET}-token target.`);
  process.exit(1);
}
console.log(`✓ PASS: PDS is under the ${BUDGET}-token target and structurally complete.`);
