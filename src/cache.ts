import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/** Freshness window for cached REST results (overridable via env, for tests). */
export const DEFAULT_TTL_MS = Number(process.env.PLUMB_CACHE_TTL_MS) || 5 * 60_000;

/**
 * Cache root — under ~/.cache/plumb, overridable via PLUMB_CACHE_DIR. Resolved
 * lazily so a test can repoint it at a temp directory at runtime.
 */
function cacheDir(): string {
  const base = process.env.PLUMB_CACHE_DIR ?? join(homedir(), ".cache", "plumb");
  return join(base, "v1");
}

function pathFor(key: string): string {
  const hash = createHash("sha1").update(key).digest("hex").slice(0, 20);
  return join(cacheDir(), `${hash}.json`);
}

export interface CacheEntry<T> {
  version: string;
  savedAt: number;
  payload: T;
}

/**
 * On-disk result cache (plan §4). Best-effort: a miss, a stale entry, or any
 * IO error returns undefined — a failed cache never fails a request.
 *
 * M1 uses a TTL for freshness. Once the plugin path streams `documentchange`
 * events, invalidation becomes exact and version-keyed.
 */
export function cacheGet<T>(key: string, maxAgeMs: number): CacheEntry<T> | undefined {
  try {
    const entry = JSON.parse(readFileSync(pathFor(key), "utf8")) as CacheEntry<T>;
    if (Date.now() - entry.savedAt > maxAgeMs) return undefined;
    return entry;
  } catch {
    return undefined;
  }
}

export function cacheSet<T>(key: string, version: string, payload: T): void {
  try {
    mkdirSync(cacheDir(), { recursive: true });
    const entry: CacheEntry<T> = { version, savedAt: Date.now(), payload };
    writeFileSync(pathFor(key), JSON.stringify(entry));
  } catch {
    // best-effort — a cache write failure must not fail the request
  }
}
