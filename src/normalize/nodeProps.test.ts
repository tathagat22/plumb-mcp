import { describe, expect, it } from "vitest";
import type { FigmaNode } from "../figma/types";
import {
  childSizing,
  normalizeComponentProps,
  normalizeMaskType,
  normalizeStrokeAlign,
  perSideStrokeWidths,
} from "./nodeProps";

/**
 * Two things make this module worth its own tests. First, several fields
 * arrive in two different shapes depending on whether the data came from the
 * REST API or the plugin, and only one of the two is ever exercised in a given
 * session — so the other rots silently. Second, most of these functions are
 * expected to return `undefined` far more often than not: emitting a default
 * that the PDS already implies is how a spec turns into noise.
 */

const node = (over: Partial<FigmaNode> = {}): FigmaNode =>
  ({ id: "1:1", name: "Node", type: "FRAME", ...over }) as FigmaNode;

describe("childSizing", () => {
  it("reports fill and hug per axis", () => {
    expect(
      childSizing(node({ layoutSizingHorizontal: "FILL", layoutSizingVertical: "HUG" })),
    ).toEqual({ w: "fill", h: "hug" });
  });

  it("omits FIXED, which box.{w,h} already says", () => {
    expect(
      childSizing(node({ layoutSizingHorizontal: "FIXED", layoutSizingVertical: "FIXED" })),
    ).toBeUndefined();
  });

  it("emits only the axis that is set", () => {
    expect(childSizing(node({ layoutSizingHorizontal: "FILL" }))).toEqual({ w: "fill" });
    expect(childSizing(node({ layoutSizingVertical: "FILL" }))).toEqual({ h: "fill" });
  });

  it("returns undefined for a node with no sizing information", () => {
    expect(childSizing(node())).toBeUndefined();
  });
});

describe("normalizeStrokeAlign", () => {
  it.each([
    ["INSIDE", "inside"],
    ["OUTSIDE", "outside"],
    ["CENTER", "center"],
  ])("maps %s to %s", (input, expected) => {
    expect(normalizeStrokeAlign(input)).toBe(expected);
  });

  it.each([undefined, "UNKNOWN"])("returns undefined for %s", (input) => {
    expect(normalizeStrokeAlign(input)).toBeUndefined();
  });
});

describe("perSideStrokeWidths", () => {
  it("reads the REST shape (individualStrokeWeights)", () => {
    const fn = node({ individualStrokeWeights: { top: 2, right: 1, bottom: 1, left: 1 } });
    expect(perSideStrokeWidths(fn, 1)).toEqual({ t: 2, r: 1, b: 1, l: 1 });
  });

  it("reads the plugin shape (flat strokeTopWeight etc.)", () => {
    // The plugin path never populates individualStrokeWeights, so this branch
    // is the one that runs in every paired session.
    const fn = node({
      strokeTopWeight: 2,
      strokeRightWeight: 1,
      strokeBottomWeight: 1,
      strokeLeftWeight: 1,
    } as Partial<FigmaNode>);
    expect(perSideStrokeWidths(fn, 1)).toEqual({ t: 2, r: 1, b: 1, l: 1 });
  });

  it("prefers the REST shape when both are somehow present", () => {
    const fn = node({
      individualStrokeWeights: { top: 4, right: 1, bottom: 1, left: 1 },
      strokeTopWeight: 2,
    } as Partial<FigmaNode>);
    expect(perSideStrokeWidths(fn, 1)?.t).toBe(4);
  });

  it("returns undefined when every side matches — strokeW already covers it", () => {
    const fn = node({ individualStrokeWeights: { top: 1, right: 1, bottom: 1, left: 1 } });
    expect(perSideStrokeWidths(fn, 1)).toBeUndefined();
  });

  it("returns undefined when no per-side weight is present at all", () => {
    expect(perSideStrokeWidths(node(), 1)).toBeUndefined();
  });

  it("fills an unspecified side from the uniform width", () => {
    const fn = node({ individualStrokeWeights: { top: 3 } } as Partial<FigmaNode>);
    expect(perSideStrokeWidths(fn, 1)).toEqual({ t: 3, r: 1, b: 1, l: 1 });
  });

  it("falls back to 0 for a side with neither a value nor a uniform width", () => {
    const fn = node({ individualStrokeWeights: { top: 3 } } as Partial<FigmaNode>);
    expect(perSideStrokeWidths(fn, undefined)).toEqual({ t: 3, r: 0, b: 0, l: 0 });
  });
});

describe("normalizeComponentProps", () => {
  it("returns undefined for a node with no component properties", () => {
    expect(normalizeComponentProps(undefined)).toBeUndefined();
  });

  it("returns undefined for a non-object, rather than throwing", () => {
    // Shape guards matter here: this data crosses the plugin wire.
    expect(normalizeComponentProps("nope" as never)).toBeUndefined();
  });
});

describe("normalizeMaskType", () => {
  it.each([
    ["ALPHA", "alpha"],
    ["LUMINANCE", "luminance"],
    ["VECTOR", "vector"],
  ])("maps %s to %s", (input, expected) => {
    expect(normalizeMaskType(input)).toBe(expected);
  });

  it.each([undefined, "OUTLINE", "UNKNOWN"])(
    "returns undefined for %s — a renderer only needs to know it is a mask",
    (input) => {
      expect(normalizeMaskType(input)).toBeUndefined();
    },
  );
});
