import { describe, expect, it } from "vitest";
import { coerceDirectorVerdict } from "./director";

describe("coerceDirectorVerdict", () => {
  it("passes through a well-formed verdict", () => {
    const out = coerceDirectorVerdict({
      score: 72,
      verdict: "Solid but flat.",
      issues: [
        { dimension: "hierarchy", severity: "warn", message: "flat", fix: "bolder heading" },
      ],
    });
    expect(out.score).toBe(72);
    expect(out.verdict).toBe("Solid but flat.");
    expect(out.issues).toEqual([
      { dimension: "hierarchy", severity: "warn", message: "flat", fix: "bolder heading" },
    ]);
  });

  it("clamps an out-of-range score into 0–100", () => {
    expect(coerceDirectorVerdict({ score: 150, issues: [] }).score).toBe(100);
    expect(coerceDirectorVerdict({ score: -20, issues: [] }).score).toBe(0);
  });

  it("coerces an unknown dimension to polish and an unknown severity to info", () => {
    const out = coerceDirectorVerdict({
      score: 50,
      issues: [
        { dimension: "vibes", severity: "catastrophic", message: "bad vibes", fix: "fix vibes" },
      ],
    });
    expect(out.issues).toEqual([
      { dimension: "polish", severity: "info", message: "bad vibes", fix: "fix vibes" },
    ]);
  });

  it("drops issues with no usable message or fix", () => {
    const out = coerceDirectorVerdict({
      score: 50,
      issues: [{ dimension: "polish", severity: "warn" }],
    });
    expect(out.issues).toEqual([]);
  });

  it("tolerates garbage input without throwing", () => {
    expect(() => coerceDirectorVerdict(null)).not.toThrow();
    expect(() => coerceDirectorVerdict(undefined)).not.toThrow();
    expect(() => coerceDirectorVerdict("not an object")).not.toThrow();
    expect(() => coerceDirectorVerdict(42)).not.toThrow();
    expect(() => coerceDirectorVerdict([1, 2, 3])).not.toThrow();

    expect(coerceDirectorVerdict(null)).toEqual({ score: 0, issues: [] });
    expect(coerceDirectorVerdict("garbage")).toEqual({ score: 0, issues: [] });
    expect(coerceDirectorVerdict({ score: "not a number", issues: "also not an array" })).toEqual({
      score: 0,
      issues: [],
    });
  });
});
