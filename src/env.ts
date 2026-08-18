import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Zero-dependency .env loader for the shipped stdio binary.
 *
 * MCP clients (Claude Code, Cursor, Windsurf, …) spawn `dist/index.js` fresh
 * each session and only pass through whatever `process.env` they inherit — they
 * do NOT read a repo `.env`. So without this bootstrap, keys like
 * UNSPLASH_ACCESS_KEY placed in `.env` never reach live `plumb_design` calls and
 * photo sourcing silently degrades to random placeholders.
 *
 * We look in two places, first hit wins per key, and process env always wins
 * over the file (so a client's explicit `env` block still overrides):
 *   1. process.cwd()/.env      — when launched from the project directory
 *   2. <package-root>/.env      — relative to this compiled module (dist/ → ..)
 */
function applyDotEnvFile(path: string): void {
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
    if (!key) continue;
    // An empty value means "not set", not "set to the empty string".
    //
    // This matters because `.env.example` lists every variable with a blank
    // value so a fresh clone can copy it and see the full surface. Assigning
    // "" from that would be worse than useless: `process.env.X ?? default` is
    // nullish-coalescing, so an empty string SATISFIES it and silently
    // replaces every default with nothing — a cache in "", assets written to
    // "", Chrome looked up at "".
    if (!value) continue;
    // Existing env always wins, so a client's explicit `env` block overrides.
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

/** Load `.env` from cwd and the package root into process.env (idempotent-ish). */
export function loadEnv(): void {
  applyDotEnvFile(join(process.cwd(), ".env"));
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    // dist/index.js → package root is one level up; from src during dev likewise.
    applyDotEnvFile(join(here, "..", ".env"));
  } catch {
    // import.meta.url unavailable (non-ESM shim) — cwd lookup already ran.
  }
}
