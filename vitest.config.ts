import { defineConfig } from "vitest/config";

/**
 * Coverage is scoped to the code that actually implements Plumb's behaviour.
 *
 * The excludes below are deliberate rather than convenient. `scripts/` and
 * `src/cli/` are thin argv-parsing and terminal-printing shells over the
 * modules they call; `figma-plugin/` runs inside Figma's own sandbox, where
 * `figma.*` globals exist and Node does not, so it can only be exercised
 * meaningfully in the plugin itself. Counting them would inflate the
 * denominator with code no unit test can honestly reach, and hide thin
 * coverage on the parts that matter.
 */
export default defineConfig({
  test: {
    coverage: {
      provider: "v8",
      reporter: ["text-summary", "lcov", "json-summary"],
      reportsDirectory: "coverage",
      include: ["src/**/*.ts"],
      exclude: [
        "src/**/*.test.ts",
        "src/cli/**", // argv parsing + stderr progress printing
        "src/demo/cli.ts", // one-line process.exit wrapper
        "src/index.ts", // process bootstrap: signal handlers, transport wiring
        "src/**/types.ts",
        "src/figma/types.ts",
      ],
      // A ratchet, not a target: set just under today's numbers so an honest
      // refactor doesn't trip it, but deleting or bypassing a tested path
      // does. Raise these as the backfill lands — never lower them to make a
      // red build green.
      //
      // 30% → 40% → 60% over three passes. The last jump came from testing the
      // pipelines end to end rather than chasing files: compiling the shipped
      // DSL examples down to PDS and on to an EmitPlan, and normalising a real
      // Figma export through every downstream consumer, cover far more real
      // behaviour per spec than unit tests on the same code would.
      thresholds: {
        lines: 60,
        functions: 57,
        statements: 59,
        branches: 52,
      },
    },
  },
});
