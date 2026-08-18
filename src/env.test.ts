import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { loadEnv } from "./env";

/**
 * `.env.example` is the only answer a fresh clone gets to "what can I
 * configure?", and documentation that lives beside code rots the moment
 * someone adds a `process.env` read and forgets it. So the sync is asserted,
 * not maintained by hand — in both directions, because a stale entry is its own
 * kind of lie.
 *
 * The other half is the loader. Every variable in `.env.example` ships with a
 * BLANK value so the file can be copied as-is, which only works because the
 * loader treats blank as unset. If it assigned "" instead, every default in the
 * codebase would silently vanish: `process.env.X ?? fallback` is
 * nullish-coalescing, so an empty string satisfies it.
 */

const root = fileURLToPath(new URL("..", import.meta.url));
const example = readFileSync(join(root, ".env.example"), "utf8");

/** Keys declared in `.env.example`, in the `KEY=` form a copy-paste needs. */
const declared = new Set(
  example
    .split("\n")
    .map((line) => /^([A-Z][A-Z0-9_]*)=/.exec(line)?.[1])
    .filter((k): k is string => !!k),
);

/** Strip comments so a variable NAMED in prose isn't mistaken for a read. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === "dist") continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) sourceFiles(full, out);
    else if (entry.endsWith(".ts") && !entry.endsWith(".test.ts")) out.push(full);
  }
  return out;
}

/**
 * Every environment variable shipped code actually reads.
 *
 * Two patterns, both real and both load-bearing: `process.env.NAME` for the
 * places that reach for the ambient environment, and `env.NAME` where the
 * environment is injected as a parameter — which is the better pattern (it is
 * what makes `resolveBridgePorts` and the provider registry testable), and
 * would be invisible to a scanner that only knew the first.
 */
const READ_PATTERNS = [
  /process\.env\.([A-Z][A-Z0-9_]*)/g,
  /process\.env\[["']([A-Z][A-Z0-9_]*)["']\]/g,
  /\benv\.([A-Z][A-Z0-9_]*)/g,
  /\benv\[["']([A-Z][A-Z0-9_]*)["']\]/g,
];

function referencedVars(): Map<string, string[]> {
  const found = new Map<string, string[]>();
  for (const file of [...sourceFiles(join(root, "src")), ...sourceFiles(join(root, "scripts"))]) {
    const code = stripComments(readFileSync(file, "utf8"));
    for (const pattern of READ_PATTERNS) {
      for (const match of code.matchAll(pattern)) {
        const name = match[1]!;
        found.set(name, [...(found.get(name) ?? []), file.slice(root.length)]);
      }
    }
  }
  return found;
}

const referenced = referencedVars();

describe(".env.example covers the configuration surface", () => {
  it("finds the variables the source actually reads", () => {
    // Guards the guard: a broken scanner would make every assertion below pass
    // vacuously. Both read styles are represented on purpose.
    expect(referenced.size).toBeGreaterThan(10);
    expect(referenced.has("FIGMA_TOKEN"), "ambient process.env read").toBe(true);
    expect(referenced.has("PLUMB_BRIDGE_PORT"), "injected env parameter read").toBe(true);
  });

  it("declares every variable the source reads", () => {
    const missing = [...referenced.entries()]
      .filter(([name]) => !declared.has(name))
      .map(([name, files]) => `${name} (read in ${files[0]})`);
    expect(missing, "add these to .env.example").toEqual([]);
  });

  it("declares nothing the source no longer reads", () => {
    // A stale key sends someone configuring a variable that does nothing.
    const stale = [...declared].filter((name) => !referenced.has(name));
    expect(stale, "remove these from .env.example, or wire them up").toEqual([]);
  });

  it("declares each variable exactly once", () => {
    const keys = example
      .split("\n")
      .map((line) => /^([A-Z][A-Z0-9_]*)=/.exec(line)?.[1])
      .filter((k): k is string => !!k);
    expect(keys.length).toBe(new Set(keys).size);
  });

  it("ships every value blank, so the file can be copied as-is", () => {
    // A default baked in here becomes a default someone accidentally pins.
    const withValues = example
      .split("\n")
      .filter((line) => /^[A-Z][A-Z0-9_]*=.+/.test(line));
    expect(withValues).toEqual([]);
  });

  it("explains each variable — a bare key list helps nobody", () => {
    const lines = example.split("\n");
    for (const [i, line] of lines.entries()) {
      if (!/^([A-Z][A-Z0-9_]*)=/.test(line)) continue;
      // Walk back over the blank line to the comment block above.
      let j = i - 1;
      while (j >= 0 && lines[j]!.trim() === "") j -= 1;
      expect(lines[j]?.startsWith("#"), `${line.split("=")[0]} has no comment`).toBe(true);
    }
  });

  it("mentions no secret-looking value", () => {
    expect(example).not.toMatch(/figd_[A-Za-z0-9]{10,}/);
    expect(example).not.toMatch(/sk-ant-[A-Za-z0-9]{10,}/);
  });
});

describe("loadEnv", () => {
  const created: string[] = [];
  const originalCwd = process.cwd();
  /** name → the value before this test touched it, so a real FIGMA_TOKEN in
   *  the developer's environment survives the suite. */
  const saved = new Map<string, string | undefined>();

  /** Write a .env in a temp dir and load from there. */
  function loadFrom(contents: string): void {
    const dir = mkdtempSync(join(tmpdir(), "plumb-env-"));
    created.push(dir);
    writeFileSync(join(dir, ".env"), contents);
    process.chdir(dir);
    loadEnv();
  }

  function track(...keys: string[]): void {
    for (const k of keys) if (!saved.has(k)) saved.set(k, process.env[k]);
  }

  afterEach(() => {
    process.chdir(originalCwd);
    for (const dir of created.splice(0)) rmSync(dir, { recursive: true, force: true });
    for (const [key, value] of saved) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    saved.clear();
  });

  it("reads a simple assignment", () => {
    track("PLUMB_TEST_SIMPLE");
    loadFrom("PLUMB_TEST_SIMPLE=hello\n");
    expect(process.env.PLUMB_TEST_SIMPLE).toBe("hello");
  });

  it("treats a blank value as unset, leaving the default in play", () => {
    // The property the whole `.env.example` design rests on.
    track("PLUMB_TEST_BLANK");
    loadFrom("PLUMB_TEST_BLANK=\n");
    expect(process.env.PLUMB_TEST_BLANK).toBeUndefined();
    expect(process.env.PLUMB_TEST_BLANK ?? "the-default").toBe("the-default");
  });

  it("treats a whitespace-only value as unset too", () => {
    track("PLUMB_TEST_SPACES");
    loadFrom("PLUMB_TEST_SPACES=    \n");
    expect(process.env.PLUMB_TEST_SPACES).toBeUndefined();
  });

  it("loads the real .env.example without setting a single variable", () => {
    // The end-to-end version: copying the shipped template must be a no-op.
    // Compared before/after rather than against `undefined`, because a
    // developer running this suite may legitimately have FIGMA_TOKEN exported.
    track(...declared);
    const before = new Map([...declared].map((k) => [k, process.env[k]]));
    loadFrom(example);
    for (const key of declared) {
      expect(process.env[key], `${key} was changed by a blank template entry`).toBe(
        before.get(key),
      );
    }
  });

  it("lets existing env win, so a client's own config is never overridden", () => {
    track("PLUMB_TEST_WINS");
    process.env.PLUMB_TEST_WINS = "from-the-client";
    loadFrom("PLUMB_TEST_WINS=from-the-file\n");
    expect(process.env.PLUMB_TEST_WINS).toBe("from-the-client");
  });

  it("strips surrounding quotes", () => {
    track("PLUMB_TEST_DQ", "PLUMB_TEST_SQ");
    loadFrom('PLUMB_TEST_DQ="quoted value"\nPLUMB_TEST_SQ=\'single\'\n');
    expect(process.env.PLUMB_TEST_DQ).toBe("quoted value");
    expect(process.env.PLUMB_TEST_SQ).toBe("single");
  });

  it("ignores comments and blank lines", () => {
    track("PLUMB_TEST_AFTER_COMMENT");
    loadFrom("# a comment\n\n   \nPLUMB_TEST_AFTER_COMMENT=ok\n");
    expect(process.env.PLUMB_TEST_AFTER_COMMENT).toBe("ok");
  });

  it("keeps an '=' that appears inside a value", () => {
    track("PLUMB_TEST_EQUALS");
    loadFrom("PLUMB_TEST_EQUALS=a=b=c\n");
    expect(process.env.PLUMB_TEST_EQUALS).toBe("a=b=c");
  });

  it("skips a malformed line rather than throwing", () => {
    track("PLUMB_TEST_AFTER_JUNK");
    expect(() => loadFrom("this line has no equals\nPLUMB_TEST_AFTER_JUNK=ok\n")).not.toThrow();
    expect(process.env.PLUMB_TEST_AFTER_JUNK).toBe("ok");
  });

  it("does nothing when there is no .env at all", () => {
    const dir = mkdtempSync(join(tmpdir(), "plumb-env-"));
    created.push(dir);
    process.chdir(dir);
    expect(() => loadEnv()).not.toThrow();
  });
});
