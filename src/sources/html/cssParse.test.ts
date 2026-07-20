import { describe, expect, it } from "vitest";
import { parseBoxShadow, parseGradient } from "./cssParse";

describe("parseGradient", () => {
  it("parses a linear gradient with an explicit angle and percentage stops", () => {
    const fill = parseGradient("linear-gradient(90deg, rgb(12, 140, 233) 0%, rgb(255, 0, 102) 100%)");

    expect(fill).toEqual({
      type: "linear-gradient",
      angle: 90,
      stops: [
        { at: 0, color: "#0c8ce9" },
        { at: 1, color: "#ff0066" },
      ],
    });
  });

  it("defaults the angle to 180 (CSS's own default direction) when none is given", () => {
    const fill = parseGradient("linear-gradient(rgb(0, 0, 0) 0%, rgb(255, 255, 255) 100%)");

    expect(fill?.type === "linear-gradient" && fill.angle).toBe(180);
  });

  it("handles rgba() stops with alpha", () => {
    const fill = parseGradient("linear-gradient(0deg, rgba(0, 0, 0, 0) 0%, rgba(0, 0, 0, 0.8) 100%)");

    expect(fill?.type === "linear-gradient" && fill.stops[1]?.color).toBe("#000000cc");
  });

  it("returns undefined for a solid color, url(), or non-gradient string", () => {
    expect(parseGradient("none")).toBeUndefined();
    expect(parseGradient('url("bg.png")')).toBeUndefined();
    expect(parseGradient("rgb(0, 0, 0)")).toBeUndefined();
  });

  it("returns undefined for radial/conic gradients — a materially different, unsupported grammar", () => {
    expect(parseGradient("radial-gradient(circle, rgb(0,0,0) 0%, rgb(255,255,255) 100%)")).toBeUndefined();
    expect(parseGradient("conic-gradient(rgb(0,0,0), rgb(255,255,255))")).toBeUndefined();
  });

  it("returns undefined for a single-stop gradient", () => {
    expect(parseGradient("linear-gradient(90deg, rgb(0, 0, 0) 0%)")).toBeUndefined();
  });
});

describe("parseBoxShadow", () => {
  it("parses a single shadow in Chrome's color-first computed form", () => {
    const effects = parseBoxShadow("rgba(0, 0, 0, 0.1) 0px 4px 6px -1px");

    // 0.1 alpha → byte 26 (0x1a); the color preserves alpha, it isn't dropped.
    expect(effects).toEqual([{ type: "drop-shadow", x: 0, y: 4, blur: 6, spread: -1, color: "#0000001a" }]);
  });

  it("parses multiple comma-separated shadows", () => {
    const effects = parseBoxShadow(
      "rgba(0, 0, 0, 0.1) 0px 4px 6px -1px, rgba(0, 0, 0, 0.06) 0px 2px 4px -2px",
    );

    expect(effects).toHaveLength(2);
    expect(effects[1]).toEqual({ type: "drop-shadow", x: 0, y: 2, blur: 4, spread: -2, color: "#0000000f" });
  });

  it("recognizes inset (inner-shadow) whether it leads or trails", () => {
    expect(parseBoxShadow("inset rgba(0,0,0,0.2) 0px 1px 2px 0px")[0]?.type).toBe("inner-shadow");
    expect(parseBoxShadow("rgba(0,0,0,0.2) 0px 1px 2px 0px inset")[0]?.type).toBe("inner-shadow");
  });

  it("returns [] for 'none' or an empty string", () => {
    expect(parseBoxShadow("none")).toEqual([]);
    expect(parseBoxShadow("")).toEqual([]);
  });

  it("skips an unparseable segment instead of throwing, and still returns the parseable ones", () => {
    const effects = parseBoxShadow("garbage, rgba(0, 0, 0, 0.1) 0px 4px 6px -1px");

    expect(effects).toHaveLength(1);
  });
});
