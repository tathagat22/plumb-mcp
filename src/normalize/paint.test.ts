import { describe, expect, it } from "vitest";
import { paintsToFillStack } from "./paint";
import type { FigmaPaint } from "../figma/types";

describe("paintsToFillStack — image adjustment filters (Phase F6)", () => {
  it("maps exposure/contrast/saturation to a CSS filter string, 1 + value convention", () => {
    const paint: FigmaPaint = {
      type: "IMAGE",
      imageRef: "abc123",
      filters: { exposure: 0.5, contrast: -0.2, saturation: 0.3 },
    };

    const [fill] = paintsToFillStack([paint])!;
    expect(fill?.type).toBe("image");
    if (fill?.type !== "image") throw new Error("expected image fill");
    expect(fill.cssFilter).toBe("brightness(1.5) contrast(0.8) saturate(1.3)");
    expect(fill.filtersRaw).toEqual({ exposure: 0.5, contrast: -0.2, saturation: 0.3 });
  });

  it("omits cssFilter (but keeps filtersRaw) for filters with no CSS equivalent", () => {
    const paint: FigmaPaint = {
      type: "IMAGE",
      imageRef: "abc123",
      filters: { temperature: 0.4, tint: -0.1 },
    };

    const [fill] = paintsToFillStack([paint])!;
    if (fill?.type !== "image") throw new Error("expected image fill");
    expect(fill.cssFilter).toBeUndefined();
    expect(fill.filtersRaw).toEqual({ temperature: 0.4, tint: -0.1 });
  });

  it("omits both fields when every filter is 0 or absent", () => {
    const zeroed: FigmaPaint = { type: "IMAGE", imageRef: "a", filters: { exposure: 0, contrast: 0 } };
    const absent: FigmaPaint = { type: "IMAGE", imageRef: "b" };

    const [f1] = paintsToFillStack([zeroed])!;
    const [f2] = paintsToFillStack([absent])!;
    if (f1?.type !== "image" || f2?.type !== "image") throw new Error("expected image fills");
    expect(f1.cssFilter).toBeUndefined();
    expect(f1.filtersRaw).toBeUndefined();
    expect(f2.cssFilter).toBeUndefined();
    expect(f2.filtersRaw).toBeUndefined();
  });

  it("partial filter sets only emit the functions that were actually set", () => {
    const paint: FigmaPaint = { type: "IMAGE", imageRef: "a", filters: { saturation: -0.5 } };

    const [fill] = paintsToFillStack([paint])!;
    if (fill?.type !== "image") throw new Error("expected image fill");
    expect(fill.cssFilter).toBe("saturate(0.5)");
  });
});
