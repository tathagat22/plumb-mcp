import { describe, expect, it } from "vitest";
import {
  computeLineHeightRatio,
  normalizeWeight,
  parseBlurRadius,
  parsePx,
  parseRotation,
  parseShadowBlur,
  parseTextToken,
  round,
} from "./parse";

/**
 * These parsers sit between a browser's computed styles and the deltas Plumb
 * reports, so the failure mode that matters is not "wrong answer" but "confident
 * wrong answer": returning a number for something unparseable produces a delta
 * against code that is actually correct. Every case below is either a real
 * `getComputedStyle` output shape or a value that must come back `null`.
 */

describe("parsePx", () => {
  it.each([
    ["24px", 24],
    ["0", 0],
    ["0px", 0],
    ["-12px", -12],
    ["13.5px", 13.5],
    ["  16px  ", 16],
    ["16PX", 16],
  ])("parses %s", (input, expected) => {
    expect(parsePx(input)).toBe(expected);
  });

  it.each([undefined, "", "auto", "normal"])(
    "returns null for %s rather than guessing zero",
    (input) => {
      expect(parsePx(input)).toBeNull();
    },
  );

  it("falls back to a bare number for unit-less computed values", () => {
    expect(parsePx("16")).toBe(16);
  });

  it("returns null for a value it cannot make a number of", () => {
    expect(parsePx("inherit")).toBeNull();
  });
});

describe("parseTextToken", () => {
  it("parses weight, size, line-height ratio and family", () => {
    expect(parseTextToken("700 48px/1.1 Inter")).toEqual({
      weight: 700,
      size: 48,
      lh: 1.1,
      family: "Inter",
    });
  });

  it("parses a token with no line-height", () => {
    expect(parseTextToken("400 16px Inter")).toEqual({
      weight: 400,
      size: 16,
      lh: undefined,
      family: "Inter",
    });
  });

  it("parses a token with no family", () => {
    expect(parseTextToken("600 20px/1.3")).toMatchObject({ weight: 600, size: 20, lh: 1.3 });
  });

  it("keeps a multi-word family intact", () => {
    expect(parseTextToken("500 14px/1.4 SF Pro Display")?.family).toBe("SF Pro Display");
  });

  it("handles a fractional size", () => {
    expect(parseTextToken("400 13.5px Inter")?.size).toBe(13.5);
  });

  it("tolerates spaces around the line-height slash", () => {
    expect(parseTextToken("400 16px / 1.5 Inter")?.lh).toBe(1.5);
  });

  it.each(["", "Inter", "16px Inter", "bold 16px Inter"])(
    "returns null for the malformed token %s",
    (input) => {
      expect(parseTextToken(input)).toBeNull();
    },
  );
});

describe("normalizeWeight", () => {
  it.each([
    ["700", 700],
    ["400", 400],
    ["normal", 400],
    ["bold", 700],
    ["lighter", 300],
    ["bolder", 800],
    ["BOLD", 700],
  ])("maps %s to %i", (input, expected) => {
    expect(normalizeWeight(input)).toBe(expected);
  });

  it.each([undefined, "", "semibold", "600italic"])("returns null for %s", (input) => {
    expect(normalizeWeight(input)).toBeNull();
  });
});

describe("computeLineHeightRatio", () => {
  it("divides a px line-height by the font size", () => {
    expect(computeLineHeightRatio("24px", 16)).toBe(1.5);
  });

  it("passes a unit-less ratio straight through", () => {
    expect(computeLineHeightRatio("1.5", 16)).toBe(1.5);
  });

  it("reads a percentage as the ratio it is, not as pixels", () => {
    // Regression: parsePx's bare-parseFloat fallback used to turn "150%" into
    // 150 and then divide by the font size, reporting a 9.4x line-height.
    expect(computeLineHeightRatio("150%", 16)).toBe(1.5);
  });

  it("does not need the font size for unit-less or percentage values", () => {
    expect(computeLineHeightRatio("1.5", null)).toBe(1.5);
    expect(computeLineHeightRatio("150%", null)).toBe(1.5);
  });

  it("returns null when the font size is unknown or zero", () => {
    expect(computeLineHeightRatio("24px", null)).toBeNull();
    expect(computeLineHeightRatio("24px", 0)).toBeNull();
  });

  it("returns null when there is no line-height at all", () => {
    expect(computeLineHeightRatio(undefined, 16)).toBeNull();
  });
});

describe("parseRotation", () => {
  it("reads a plain rotate()", () => {
    expect(parseRotation("rotate(45deg)")).toBe(45);
  });

  it("reads rotateZ() and negative angles", () => {
    expect(parseRotation("rotateZ(-90deg)")).toBe(-90);
  });

  it.each([undefined, "none"])("returns null for %s", (input) => {
    expect(parseRotation(input)).toBeNull();
  });

  it("derives the angle from a 2D matrix", () => {
    // matrix(cos, sin, -sin, cos, tx, ty) for 90°.
    expect(parseRotation("matrix(0, 1, -1, 0, 0, 0)")).toBeCloseTo(90, 5);
  });

  it("returns null for a 3D matrix it cannot reduce", () => {
    expect(parseRotation("matrix3d(1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1)")).toBeNull();
  });
});

describe("parseBlurRadius", () => {
  it("pulls the radius out of a backdrop-filter", () => {
    expect(parseBlurRadius("blur(12px)")).toBe(12);
  });

  it("finds blur() among other filter functions", () => {
    expect(parseBlurRadius("saturate(180%) blur(20px)")).toBe(20);
  });

  it.each([undefined, "none", "saturate(180%)"])("returns null for %s", (input) => {
    expect(parseBlurRadius(input)).toBeNull();
  });
});

describe("parseShadowBlur", () => {
  it("reads the blur — the third length — of a box-shadow", () => {
    expect(parseShadowBlur("0px 8px 24px rgba(0, 0, 0, 0.24)")).toBe(24);
  });

  it("uses only the first layer of a stacked shadow", () => {
    // Commas inside rgba() must not split the layers.
    expect(parseShadowBlur("0px 2px 4px rgba(0,0,0,0.1), 0px 40px 80px rgba(0,0,0,0.5)")).toBe(4);
  });

  it("ignores an `inset` keyword and a hex colour", () => {
    expect(parseShadowBlur("inset 0px 1px 3px #00000033")).toBe(3);
  });

  it.each([undefined, "none", "0px 2px black"])(
    "returns null for %s rather than inventing a blur",
    (input) => {
      expect(parseShadowBlur(input)).toBeNull();
    },
  );
});

describe("round", () => {
  it.each([
    [1.005, 2, 1.0],
    [1.2345, 2, 1.23],
    [1.2355, 2, 1.24],
    [42, 0, 42],
    [-1.235, 2, -1.24],
  ])("rounds %f to %i places", (n, places, expected) => {
    expect(round(n, places)).toBe(expected);
  });
});
