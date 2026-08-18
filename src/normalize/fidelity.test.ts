import { describe, expect, it } from "vitest";
import type { FigmaNode } from "../figma/types";
import {
  buildNotes,
  cornerRadius,
  cssBlendMode,
  pdsConstraint,
  pdsTextCase,
  pdsTextGrow,
  relativePos,
} from "./fidelity";

/**
 * Small conversions, high blast radius: every one of these lands directly on a
 * PdsNode that an agent reads as the spec. The cases worth pinning are the
 * ones where Figma's representation is actively misleading — a corner radius
 * of 21243700 meaning "pill", an auto-layout child whose x/y is meaningless.
 */

const node = (over: Partial<FigmaNode> = {}): FigmaNode =>
  ({ id: "1:1", name: "Node", type: "FRAME", ...over }) as FigmaNode;

const box = (w: number, h: number) => ({ w, h });

describe("cornerRadius", () => {
  it("returns undefined for a square corner, so the field is simply absent", () => {
    expect(cornerRadius(node({ cornerRadius: 0 }), box(100, 40))).toBeUndefined();
    expect(cornerRadius(node(), box(100, 40))).toBeUndefined();
  });

  it("passes a plain uniform radius through", () => {
    expect(cornerRadius(node({ cornerRadius: 12 }), box(100, 40))).toBe(12);
  });

  it("normalises Figma's fully-rounded sentinel to \"full\"", () => {
    // Figma stores "fully rounded" as a giant integer. Shipping 21243700 as
    // literal pixels would make an agent guess.
    expect(cornerRadius(node({ cornerRadius: 21243700 }), box(240, 46))).toBe("full");
  });

  it("treats any radius at or past half the shorter side as a pill", () => {
    expect(cornerRadius(node({ cornerRadius: 23 }), box(240, 46))).toBe("full");
    expect(cornerRadius(node({ cornerRadius: 22 }), box(240, 46))).toBe(22);
  });

  it("collapses four equal per-corner radii to one number", () => {
    expect(cornerRadius(node({ rectangleCornerRadii: [8, 8, 8, 8] }), box(100, 40))).toBe(8);
  });

  it("keeps a genuinely per-corner radius as a tuple", () => {
    expect(cornerRadius(node({ rectangleCornerRadii: [8, 8, 0, 0] }), box(100, 40))).toEqual([
      8, 8, 0, 0,
    ]);
  });

  it("clamps a sentinel corner inside a mixed tuple to half the shorter side", () => {
    // A tuple can't say "full", so the sentinel has to resolve to a real px
    // value or the renderer would draw a 21243700px corner.
    expect(cornerRadius(node({ rectangleCornerRadii: [21243700, 0, 0, 0] }), box(100, 40))).toEqual(
      [20, 0, 0, 0],
    );
  });

  it("drops an all-zero per-corner tuple", () => {
    expect(cornerRadius(node({ rectangleCornerRadii: [0, 0, 0, 0] }), box(100, 40))).toBeUndefined();
  });
});

describe("cssBlendMode", () => {
  it("omits the modes that mean 'no blending'", () => {
    expect(cssBlendMode("PASS_THROUGH")).toBeUndefined();
    expect(cssBlendMode("NORMAL")).toBeUndefined();
  });

  it.each([
    ["MULTIPLY", "multiply"],
    ["COLOR_BURN", "color-burn"],
    ["SOFT_LIGHT", "soft-light"],
    ["LUMINOSITY", "luminosity"],
  ])("maps %s to the CSS keyword %s", (figma, css) => {
    expect(cssBlendMode(figma)).toBe(css);
  });

  it.each([
    ["LINEAR_BURN", "plus-darker"],
    ["LINEAR_DODGE", "plus-lighter"],
  ])("maps %s to %s, which is not a name-mangling of the input", (figma, css) => {
    expect(cssBlendMode(figma)).toBe(css);
  });

  it("lower-cases an unknown mode rather than dropping it", () => {
    expect(cssBlendMode("FUTURE_MODE")).toBe("future_mode");
  });
});

describe("pdsTextCase", () => {
  it.each([
    ["UPPER", "UPPER"],
    ["LOWER", "LOWER"],
    ["TITLE", "TITLE"],
  ])("passes %s through", (input, expected) => {
    expect(pdsTextCase(input)).toBe(expected);
  });

  it.each([undefined, "ORIGINAL", "SMALL_CAPS", "SMALL_CAPS_FORCED"])(
    "omits %s — there is no CSS text-transform that reproduces it",
    (input) => {
      expect(pdsTextCase(input)).toBeUndefined();
    },
  );
});

describe("pdsTextGrow", () => {
  it.each([
    ["HEIGHT", "h"],
    ["WIDTH_AND_HEIGHT", "wh"],
    ["TRUNCATE", "trunc"],
  ])("maps %s to %s", (input, expected) => {
    expect(pdsTextGrow(input)).toBe(expected);
  });

  it("omits NONE, which is the default and carries no information", () => {
    expect(pdsTextGrow("NONE")).toBeUndefined();
  });
});

describe("pdsConstraint", () => {
  it("resolves MIN/MAX against the axis", () => {
    expect(pdsConstraint("MIN", "h")).toBe("left");
    expect(pdsConstraint("MIN", "v")).toBe("top");
    expect(pdsConstraint("MAX", "h")).toBe("right");
    expect(pdsConstraint("MAX", "v")).toBe("bottom");
  });

  it.each(["CENTER", "STRETCH", "SCALE"])("maps the axis-independent %s", (input) => {
    expect(pdsConstraint(input, "h")).toBe(input.toLowerCase());
  });

  it.each([undefined, "UNKNOWN"])("omits %s", (input) => {
    expect(pdsConstraint(input, "h")).toBeUndefined();
  });
});

describe("relativePos", () => {
  const parent = (over: Partial<FigmaNode> = {}) =>
    node({ absoluteBoundingBox: { x: 100, y: 200, width: 500, height: 400 }, ...over });
  const child = (over: Partial<FigmaNode> = {}) =>
    node({ absoluteBoundingBox: { x: 140, y: 260, width: 100, height: 40 }, ...over });

  it("returns the offset from the parent's top-left", () => {
    expect(relativePos(parent(), child())).toEqual({ x: 40, y: 60 });
  });

  it("omits the position when the parent's auto-layout places the child", () => {
    // x/y here would be redundant noise the renderer must ignore.
    expect(relativePos(parent({ layoutMode: "VERTICAL" }), child())).toBeUndefined();
    expect(relativePos(parent({ layoutMode: "HORIZONTAL" }), child())).toBeUndefined();
  });

  it("honours the Absolute-position toggle on an auto-layout child", () => {
    expect(
      relativePos(
        parent({ layoutMode: "VERTICAL" }),
        child({ layoutPositioning: "ABSOLUTE" } as Partial<FigmaNode>),
      ),
    ).toEqual({ x: 40, y: 60 });
  });

  it("returns undefined when either bounding box is missing", () => {
    expect(relativePos(parent(), node())).toBeUndefined();
    expect(relativePos(node(), child())).toBeUndefined();
    expect(relativePos(undefined, child())).toBeUndefined();
  });

  it("keeps a LayoutMode of NONE positional", () => {
    expect(relativePos(parent({ layoutMode: "NONE" }), child())).toEqual({ x: 40, y: 60 });
  });
});

describe("buildNotes", () => {
  it("returns nothing for a plain frame", () => {
    expect(buildNotes(node())).toEqual([]);
  });

  it("names the auto-layout direction", () => {
    expect(buildNotes(node({ layoutMode: "VERTICAL" }))).toContain("auto-layout VERTICAL");
  });

  it("does not report NONE as auto-layout", () => {
    expect(buildNotes(node({ layoutMode: "NONE" }))).toEqual([]);
  });

  it.each([
    ["FIXED", "fixed width"],
    ["FILL", "fills width"],
    ["HUG", "hugs contents"],
  ])("describes horizontal sizing %s", (sizing, note) => {
    expect(buildNotes(node({ layoutSizingHorizontal: sizing }))).toContain(note);
  });
});
