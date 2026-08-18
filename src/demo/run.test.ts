import { afterEach, describe, expect, it, vi } from "vitest";
import { PRICING_PDS } from "./fixture";
import { runDemoCli, summarize } from "./run";
import { runScenario } from "./scenario";

/**
 * `plumb-mcp demo` is the first thing a stranger runs, and its exit code is a
 * claim: zero means the engine caught every planted fault and invented none.
 * CI runs `demo --json` as a gate, so these specs cover the contract that gate
 * depends on — the exit code, the JSON shape, and the report never crashing on
 * the way to producing them.
 */

/** Run the CLI with stdout captured. */
async function capture(argv: string[]): Promise<{ code: number; out: string }> {
  const chunks: string[] = [];
  const spy = vi
    .spyOn(process.stdout, "write")
    .mockImplementation((chunk: string | Uint8Array) => {
      chunks.push(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString());
      return true;
    });
  try {
    const code = await runDemoCli(argv);
    return { code, out: chunks.join("") };
  } finally {
    spy.mockRestore();
  }
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("--help", () => {
  it("exits 0 and describes the command", async () => {
    const { code, out } = await capture(["--help"]);
    expect(code).toBe(0);
    expect(out).toContain("plumb-mcp demo");
    expect(out).toContain("--json");
  });

  it("answers to -h as well", async () => {
    expect((await capture(["-h"])).code).toBe(0);
  });

  it("states plainly that nothing is required to run it", async () => {
    const { out } = await capture(["--help"]);
    expect(out).toMatch(/no Figma token/i);
  });
});

describe("--pds", () => {
  it("prints the design spec as valid JSON", async () => {
    const { code, out } = await capture(["--pds"]);
    expect(code).toBe(0);
    expect(JSON.parse(out)).toEqual(PRICING_PDS);
  });
});

describe("--json", () => {
  it("exits 0 and emits a machine-readable result", async () => {
    const { code, out } = await capture(["--json"]);
    expect(code).toBe(0);

    const parsed = JSON.parse(out) as {
      summary: { planted: number; caught: number; falsePositives: number; passed: boolean };
      rounds: { index: number; score: number; faults: unknown[] }[];
    };
    expect(parsed.summary).toMatchObject({ missed: 0, falsePositives: 0, passed: true });
    expect(parsed.summary.caught).toBe(parsed.summary.planted);
  });

  it("reports one entry per round, with a climbing score", async () => {
    const { out } = await capture(["--json"]);
    const { rounds } = JSON.parse(out) as { rounds: { index: number; score: number }[] };
    expect(rounds).toHaveLength(3);
    expect(rounds.map((r) => r.index)).toEqual([1, 2, 3]);
    for (let i = 1; i < rounds.length; i += 1) {
      expect(rounds[i]!.score).toBeGreaterThan(rounds[i - 1]!.score);
    }
  });

  it("names every fault it planted", async () => {
    const { out } = await capture(["--json"]);
    const { rounds } = JSON.parse(out) as {
      rounds: { faults: { id: string; label: string; detected: boolean }[] }[];
    };
    for (const fault of rounds[0]!.faults) {
      expect(typeof fault.id).toBe("string");
      expect(fault.label.length).toBeGreaterThan(0);
      expect(fault.detected).toBe(true);
    }
  });
});

describe("the human report", () => {
  it("exits 0 and prints the scoreboard", async () => {
    const { code, out } = await capture([]);
    expect(code).toBe(0);
    expect(out).toContain("Scoreboard");
    expect(out).toContain("Mistakes planted");
    expect(out).toContain("False positives");
  });

  it("shows a round header and a progress bar for each round", async () => {
    const { out } = await capture([]);
    expect(out).toContain("Round 1");
    expect(out).toContain("Round 3");
    expect(out).toMatch(/[▰▱]{10}/);
  });

  it("spells out that an unbuilt node produced no delta at all", async () => {
    // The point the report exists to make: a delta-only view would call that
    // build clean.
    const { out } = await capture([]);
    expect(out).toContain("not built");
  });

  it("names the design and what the run needs", async () => {
    const { out } = await capture([]);
    expect(out).toContain(PRICING_PDS.file.name);
    expect(out).toMatch(/no network/i);
  });

  it("closes with the converged verdict", async () => {
    const { out } = await capture([]);
    expect(out).toMatch(/pixel-perfect match/i);
  });

  it("prints without ANSI codes when stdout is not a TTY", async () => {
    // Which is how it runs in CI, in a pipe, and in the README.
    const { out } = await capture([]);
    expect(out).not.toMatch(/\[/);
  });
});

describe("summarize", () => {
  it("agrees with the scenario it summarises", () => {
    const rounds = runScenario();
    const summary = summarize(rounds);
    expect(summary.planted).toBe(rounds[0]!.outcomes.length);
    expect(summary.caught).toBe(rounds[0]!.detected);
    expect(summary.scores).toEqual(rounds.map((r) => r.fit.score));
  });

  it("does not pass when nothing was planted", () => {
    // An empty run must not read as a clean bill of health.
    expect(summarize([]).passed).toBe(false);
  });

  it("counts the nodes no fault touched", () => {
    const summary = summarize(runScenario());
    expect(summary.untouchedNodes).toBeGreaterThan(20);
    expect(summary.untouchedNodes).toBeLessThan(Object.keys(PRICING_PDS.nodes).length);
  });
});
