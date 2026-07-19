import { describe, expect, it } from "vitest";
import { contrastRatio, parseHexColor, relativeLuminance, wcagLevel } from "./contrastMath";

describe("parseHexColor", () => {
  it("parses 6-digit and 8-digit (with alpha) hex", () => {
    expect(parseHexColor("#000000")).toEqual({ r: 0, g: 0, b: 0 });
    expect(parseHexColor("#ffffff")).toEqual({ r: 255, g: 255, b: 255 });
    expect(parseHexColor("#ff006680")).toEqual({ r: 255, g: 0, b: 102 });
  });

  it("returns null for a non-hex string", () => {
    expect(parseHexColor("gradient")).toBeNull();
    expect(parseHexColor("rgb(0,0,0)")).toBeNull();
  });
});

describe("relativeLuminance / contrastRatio — W3C reference values", () => {
  it("black-on-white contrast ratio is 21:1", () => {
    const black = parseHexColor("#000000")!;
    const white = parseHexColor("#ffffff")!;
    expect(contrastRatio(black, white)).toBeCloseTo(21, 1);
  });

  it("same color against itself is 1:1", () => {
    const gray = parseHexColor("#808080")!;
    expect(contrastRatio(gray, gray)).toBeCloseTo(1, 5);
  });

  it("is symmetric regardless of argument order", () => {
    const a = parseHexColor("#123456")!;
    const b = parseHexColor("#abcdef")!;
    expect(contrastRatio(a, b)).toBeCloseTo(contrastRatio(b, a), 10);
  });

  it("black has zero relative luminance, white has 1.0", () => {
    expect(relativeLuminance(parseHexColor("#000000")!)).toBeCloseTo(0, 5);
    expect(relativeLuminance(parseHexColor("#ffffff")!)).toBeCloseTo(1, 5);
  });
});

describe("wcagLevel", () => {
  it("classifies normal text against the 4.5 / 7.0 thresholds", () => {
    expect(wcagLevel(3.0, false)).toBe("fail");
    expect(wcagLevel(4.5, false)).toBe("AA");
    expect(wcagLevel(6.9, false)).toBe("AA");
    expect(wcagLevel(7.0, false)).toBe("AAA");
  });

  it("classifies large text against the relaxed 3.0 / 4.5 thresholds", () => {
    expect(wcagLevel(2.9, true)).toBe("fail");
    expect(wcagLevel(3.0, true)).toBe("AA");
    expect(wcagLevel(4.5, true)).toBe("AAA");
  });
});
