/**
 * Offline checks — no network, no credentials. Verifies fit-to-budget depth
 * reduction (on the bundled fixture) and the on-disk cache (set / get / TTL).
 * This is the reliable regression test when the live REST path is rate-limited.
 */
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// Point the cache at a throwaway dir (cache.ts reads PLUMB_CACHE_DIR lazily).
process.env.PLUMB_CACHE_DIR = mkdtempSync(join(tmpdir(), "plumb-check-"));

import { cacheGet, cacheSet } from "../src/cache";
import { normalize } from "../src/normalize/normalize";
import { normalizeToBudget } from "../src/normalize/budget";
import type { FigmaFileResult, FigmaNode } from "../src/figma/types";

const here = dirname(fileURLToPath(import.meta.url));
const raw = readFileSync(join(here, "fixtures", "export-employees.json"), "utf8");
const file: FigmaFileResult = {
  document: JSON.parse(raw) as FigmaNode,
  fileName: "Fixture",
  version: "fixture-0",
};

let failed = 0;
function check(label: string, ok: boolean, detail = ""): void {
  console.log(`${ok ? "✓" : "✗"} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failed += 1;
}

// --- fit-to-budget -------------------------------------------------------
const full = normalize(file, 99, {});
const budget = Math.floor(full.meta.estTokens / 2);
const fitted = normalizeToBudget(file, 99, budget, {});
check(
  "fit-to-budget reduces depth to meet the budget",
  fitted.meta.depthUsed < 99 && fitted.meta.estTokens <= budget,
  `full ~${full.meta.estTokens}t → fitted ~${fitted.meta.estTokens}t @ depth ${fitted.meta.depthUsed} (budget ${budget})`,
);

const unbounded = normalizeToBudget(file, 99, undefined, {});
check("no budget → no reduction", unbounded.meta.estTokens === full.meta.estTokens);

const tiny = normalizeToBudget(file, 99, 1, {});
check(
  "impossible budget → bottoms out at depth 0, flagged truncated",
  tiny.meta.depthUsed === 0 && tiny.meta.truncated === true,
);

// --- cache ---------------------------------------------------------------
cacheSet("k1", "v1", { hello: "world" });
const hit = cacheGet<{ hello: string }>("k1", 60_000);
check("cache returns a fresh entry", hit?.payload.hello === "world");
check("cache treats an aged-out entry as a miss", cacheGet("k1", -1) === undefined);
check("cache miss returns undefined", cacheGet("absent", 60_000) === undefined);

console.log("─".repeat(56));
if (failed) {
  console.error(`✗ ${failed} check(s) failed.`);
  process.exit(1);
}
console.log("✓ PASS: fit-to-budget and the cache behave correctly (offline).");
