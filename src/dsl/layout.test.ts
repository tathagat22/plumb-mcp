import { describe, expect, it, vi } from "vitest";
import type { ResolvedTypeStyle, TextMeasurer } from "./schema";
import {
  buildLayout,
  mapAlign,
  mapJustify,
  mapSelf,
  measureContainer,
  measureText,
  resolveHeight,
  resolveWidth,
  sizingFor,
} from "./layout";

/**
 * These numbers are estimates by design — Figma's auto-layout re-solves the
 * real geometry on emit — but two things about them are contracts, not
 * estimates: the `sizing` intent that travels with them (a numeric size MUST
 * become `"fixed"`, or an auto-layout frame hugs its content and collapses a
 * 64px chip down to the 30px icon inside it), and the omission of defaults
 * (emitting `justify: "flex-start"` on every node is how a compact spec turns
 * into noise).
 */

const style = (over: Partial<ResolvedTypeStyle> = {}): ResolvedTypeStyle =>
  ({ size: 16, line: 1.5, tracking: 0, weight: 400, family: "Inter", ...over }) as ResolvedTypeStyle;

describe("mapJustify / mapAlign", () => {
  it.each([
    ["center", "center"],
    ["end", "flex-end"],
    ["between", "space-between"],
  ] as const)("maps justify %s to %s", (dsl, css) => {
    expect(mapJustify(dsl)).toBe(css);
  });

  it("omits the flex default rather than emitting it on every node", () => {
    expect(mapJustify("start")).toBeUndefined();
    expect(mapAlign("start")).toBeUndefined();
  });

  it.each([
    ["center", "center"],
    ["end", "flex-end"],
    ["stretch", "stretch"],
    ["baseline", "baseline"],
  ] as const)("maps align %s to %s", (dsl, css) => {
    expect(mapAlign(dsl)).toBe(css);
  });

  it("passes undefined through", () => {
    expect(mapJustify(undefined)).toBeUndefined();
    expect(mapAlign(undefined)).toBeUndefined();
  });
});

describe("mapSelf", () => {
  it.each([
    ["start", "min"],
    ["center", "center"],
    ["end", "max"],
    ["stretch", "stretch"],
  ] as const)("maps %s to the PDS value %s", (dsl, pds) => {
    expect(mapSelf(dsl)).toBe(pds);
  });

  it("passes undefined through", () => {
    expect(mapSelf(undefined)).toBeUndefined();
  });
});

describe("resolveWidth", () => {
  it("takes the available width for `fill`", () => {
    expect(resolveWidth("fill", 960)).toBe(960);
  });

  it("passes a numeric width through", () => {
    expect(resolveWidth(304, 960)).toBe(304);
  });

  it("resolves a percentage against the available width", () => {
    expect(resolveWidth("50%", 960)).toBe(480);
    expect(resolveWidth("33.5%", 1000)).toBe(335);
  });

  it("returns undefined for `hug` so the caller measures content instead", () => {
    expect(resolveWidth("hug", 960)).toBeUndefined();
    expect(resolveWidth(undefined, 960)).toBeUndefined();
  });

  it("returns undefined for a string it cannot parse", () => {
    expect(resolveWidth("wide", 960)).toBeUndefined();
    expect(resolveWidth("50", 960)).toBeUndefined();
  });
});

describe("resolveHeight", () => {
  it("passes a numeric height through", () => {
    expect(resolveHeight(420)).toBe(420);
  });

  it("returns undefined for hug and fill — height is measured from content", () => {
    expect(resolveHeight("hug")).toBeUndefined();
    expect(resolveHeight("fill")).toBeUndefined();
    expect(resolveHeight(undefined)).toBeUndefined();
  });

  it("resolves a percentage only when a parent height is known", () => {
    expect(resolveHeight("50%", 800)).toBe(400);
    expect(resolveHeight("50%")).toBeUndefined();
  });
});

describe("sizingFor", () => {
  it("turns a numeric size into `fixed`", () => {
    // The bug this guards: without `fixed`, an auto-layout frame defaults to
    // hug and snaps back to its content after resize().
    expect(sizingFor(64, 64)).toEqual({ w: "fixed", h: "fixed" });
  });

  it("passes fill and hug through per axis", () => {
    expect(sizingFor("fill", "hug")).toEqual({ w: "fill", h: "hug" });
  });

  it("emits only the axis that carries intent", () => {
    expect(sizingFor("fill", undefined)).toEqual({ w: "fill" });
    expect(sizingFor(undefined, "hug")).toEqual({ h: "hug" });
  });

  it("returns undefined when neither axis says anything", () => {
    expect(sizingFor(undefined, undefined)).toBeUndefined();
  });

  it("ignores a percentage — it has no auto-layout equivalent", () => {
    expect(sizingFor("50%", undefined)).toBeUndefined();
  });
});

describe("measureContainer", () => {
  const pad: [number, number, number, number] = [10, 20, 10, 20];

  it("sums the main axis and takes the max on the cross axis, for a row", () => {
    const box = measureContainer("row", 8, pad, [
      { w: 100, h: 40 },
      { w: 60, h: 80 },
    ]);
    expect(box).toEqual({ w: 100 + 60 + 8 + 40, h: 80 + 20 });
  });

  it("does the same the other way round for a column", () => {
    const box = measureContainer("col", 8, pad, [
      { w: 100, h: 40 },
      { w: 60, h: 80 },
    ]);
    expect(box).toEqual({ w: 100 + 40, h: 40 + 80 + 8 + 20 });
  });

  it("adds n-1 gaps, not n", () => {
    const one = measureContainer("row", 100, [0, 0, 0, 0], [{ w: 50, h: 10 }]);
    expect(one.w).toBe(50);
    const three = measureContainer("row", 100, [0, 0, 0, 0], [
      { w: 50, h: 10 },
      { w: 50, h: 10 },
      { w: 50, h: 10 },
    ]);
    expect(three.w).toBe(150 + 200);
  });

  it("returns just the padding for an empty container", () => {
    expect(measureContainer("col", 8, pad, [])).toEqual({ w: 40, h: 20 });
  });
});

describe("measureText", () => {
  it("delegates to an injected measurer when one is available", () => {
    const measurer: TextMeasurer = { measure: vi.fn(() => ({ w: 123.456, h: 20, lines: 1 })) };
    expect(measureText("hello", style(), 400, measurer)).toEqual({ w: 123.46, h: 20 });
    expect(measurer.measure).toHaveBeenCalledWith("hello", style(), 400);
  });

  it("falls back to a single-line estimate with no measurer", () => {
    const box = measureText("hello", style(), undefined, undefined);
    expect(box.h).toBe(24); // 16px × 1.5 line
    expect(box.w).toBeGreaterThan(0);
  });

  it("wraps to multiple lines once the estimate exceeds maxWidth", () => {
    const long = "x".repeat(400);
    const box = measureText(long, style(), 200, undefined);
    expect(box.w).toBe(200);
    expect(box.h).toBeGreaterThan(24);
  });

  it("widens the estimate as tracking grows", () => {
    const tight = measureText("hello world", style(), undefined, undefined);
    const loose = measureText("hello world", style({ tracking: 2 }), undefined, undefined);
    expect(loose.w).toBeGreaterThan(tight.w);
  });

  it("gives an empty string a one-line box rather than a zero-height one", () => {
    const box = measureText("", style(), undefined, undefined);
    expect(box.h).toBe(24);
    expect(box.w).toBeGreaterThan(0);
  });
});

describe("buildLayout", () => {
  const pad: [number, number, number, number] = [32, 32, 32, 32];

  it("always carries flow and pad", () => {
    expect(buildLayout("col", { pad })).toEqual({ flow: "col", pad });
  });

  it("omits a zero gap, which the PDS default already implies", () => {
    expect(buildLayout("row", { pad, gap: 0 })).not.toHaveProperty("gap");
    expect(buildLayout("row", { pad, gap: 24 }).gap).toBe(24);
  });

  it("emits gapCross only on a wrapping container", () => {
    expect(buildLayout("row", { pad, gapCross: 12 })).not.toHaveProperty("gapCross");
    const wrapped = buildLayout("row", { pad, wrap: true, gapCross: 12 });
    expect(wrapped).toMatchObject({ wrap: true, gapCross: 12 });
  });

  it("omits justify and align when they are the flex defaults", () => {
    const layout = buildLayout("col", { pad, justify: "start", align: "start" });
    expect(layout).not.toHaveProperty("justify");
    expect(layout).not.toHaveProperty("align");
  });

  it("emits justify and align when they are not the defaults", () => {
    expect(buildLayout("col", { pad, justify: "between", align: "center" })).toMatchObject({
      justify: "space-between",
      align: "center",
    });
  });
});
