import { describe, expect, it } from "vitest";
import type { PdsLayout, PdsNode, TokenTable } from "../../pds";
import { resolveLayout, toChildLayout, toEmitLayout } from "./layout";
import { resolveColor, resolveFills, solidPaint } from "./paint";
import { parseBoxShadow, resolveRadius, resolveVector, splitShadows } from "./effects";
import { FontSet, faceFor, textAutoResize } from "./text";
import { round2 } from "./types";

/**
 * These are the conversions that decide whether a generated Figma file looks
 * like the design that was authored. The plugin executor is mechanical by
 * contract — it assigns whatever it is handed and does no maths of its own —
 * so every wrong number here reaches the canvas unchallenged.
 *
 * The cases that earn their place are the ones where PDS and Figma genuinely
 * disagree: 0..1 float channels vs hex, a primary/counter axis pair vs
 * flexbox names, and Figma's fully-rounded sentinel.
 */

const tokens = (over: Partial<TokenTable> = {}): TokenTable => ({
  color: { $c0: "#6366f1", $c1: "#ffffff", $c2: "#00000080" },
  text: { $t0: "600 16px/1.4 Inter" },
  radius: { $r0: 12, $r1: "full" },
  shadow: { $s0: "0px 8px 24px 0px #0000003d" },
  ...over,
});

const node = (over: Partial<PdsNode> = {}): PdsNode => ({
  id: "1:1",
  el: "box",
  type: "frame",
  box: { w: 100, h: 40 },
  ...over,
});

describe("resolveColor", () => {
  it("resolves a token ref through the table", () => {
    expect(resolveColor("$c0", tokens())).toBe("#6366f1");
  });

  it("passes a literal hex through", () => {
    expect(resolveColor("#ff0066", tokens())).toBe("#ff0066");
  });

  it("returns undefined for an unknown token rather than a default colour", () => {
    // A missing token must leave the fill unset. Substituting black would put
    // a wrong colour on the canvas that nobody asked for.
    expect(resolveColor("$c99", tokens())).toBeUndefined();
  });

  it("returns undefined for a value that is neither a ref nor a hex", () => {
    expect(resolveColor("rebeccapurple", tokens())).toBeUndefined();
  });
});

describe("solidPaint", () => {
  it("converts hex to Figma's 0..1 float channels", () => {
    const paint = solidPaint("#6366f1");
    expect(paint?.type).toBe("SOLID");
    if (paint?.type !== "SOLID") throw new Error("expected a solid paint");
    expect(paint.color.r).toBeCloseTo(99 / 255, 5);
    expect(paint.color.g).toBeCloseTo(102 / 255, 5);
    expect(paint.color.b).toBeCloseTo(241 / 255, 5);
  });

  it("omits opacity at full alpha, so the plan stays terse", () => {
    expect(solidPaint("#6366f1")).not.toHaveProperty("opacity");
  });

  it("carries alpha through as layer opacity when the hex has it", () => {
    expect(solidPaint("#00000080")?.opacity).toBeCloseTo(0.5, 2);
  });

  it("returns undefined for no colour", () => {
    expect(solidPaint(undefined)).toBeUndefined();
  });
});

describe("resolveFills", () => {
  // The third argument collects asset refs the fills reference, so the plan's
  // manifest can ship their bytes. Empty here — these cases are colour only.
  const refs = () => new Set<string>();

  it("returns undefined for a node with no fill at all", () => {
    expect(resolveFills(node(), tokens(), refs())).toBeUndefined();
  });

  it("lowers a single solid fill", () => {
    const paints = resolveFills(node({ fill: "$c0" }), tokens(), refs());
    expect(paints).toHaveLength(1);
    expect(paints?.[0]?.type).toBe("SOLID");
  });

  it("keeps every layer of a multi-fill stack, in order", () => {
    const paints = resolveFills(
      node({
        fills: [
          { type: "color", color: "#141c31" },
          {
            type: "linear-gradient",
            angle: 160,
            stops: [
              { at: 0, color: "#6366f133" },
              { at: 1, color: "#6366f100" },
            ],
          },
        ],
      }),
      tokens(),
      refs(),
    );
    expect(paints).toHaveLength(2);
    expect(paints?.[0]?.type).toBe("SOLID");
    expect(paints?.[1]?.type).toBe("GRADIENT_LINEAR");
  });

  it("resolves a $fN fills ref through the token table", () => {
    const t = tokens({ fills: { $f0: [{ type: "color", color: "#6366f1" }] } });
    expect(resolveFills(node({ fills: "$f0" }), t, refs())).toHaveLength(1);
  });
});

describe("resolveRadius", () => {
  it("resolves a token ref", () => {
    expect(resolveRadius("$r0", tokens())).toBe(12);
  });

  it("turns the pill token into a value large enough to fully round", () => {
    // Figma has no "full" — a renderer needs a number, and one big enough to
    // clamp to half the shorter side whatever that turns out to be.
    expect(resolveRadius("$r1", tokens())).toBe(9999);
  });

  it("passes a per-corner tuple through untouched", () => {
    expect(resolveRadius([8, 8, 0, 0], tokens())).toEqual([8, 8, 0, 0]);
  });

  it("accepts a numeric string", () => {
    expect(resolveRadius("16", tokens())).toBe(16);
  });

  it.each([undefined, "$r99", "roundish"])("returns undefined for %s", (input) => {
    expect(resolveRadius(input as string | undefined, tokens())).toBeUndefined();
  });
});

describe("splitShadows", () => {
  it("splits stacked shadows on the top-level comma", () => {
    expect(splitShadows("0px 1px 2px 0px #000, 0px 4px 8px 0px #111")).toHaveLength(2);
  });

  it("does not split inside a colour function", () => {
    // The whole reason this isn't a plain `.split(",")`.
    expect(splitShadows("0px 1px 2px 0px rgba(0, 0, 0, 0.2)")).toHaveLength(1);
  });

  it("returns one part for a single shadow", () => {
    expect(splitShadows("0px 1px 2px 0px #000")).toHaveLength(1);
  });
});

describe("parseBoxShadow", () => {
  /** EmitEffect is a union; blurs carry no colour or offset. */
  const asShadow = (e: ReturnType<typeof parseBoxShadow>[number] | undefined) => {
    if (!e || (e.type !== "DROP_SHADOW" && e.type !== "INNER_SHADOW")) {
      throw new Error(`expected a shadow, got ${e?.type ?? "nothing"}`);
    }
    return e;
  };

  it("parses offset, blur, spread and colour", () => {
    const [effect] = parseBoxShadow("0px 8px 24px 0px #0000003d");
    expect(effect).toMatchObject({
      type: "DROP_SHADOW",
      offset: { x: 0, y: 8 },
      radius: 24,
      spread: 0,
    });
    expect(asShadow(effect).color.a).toBeCloseTo(0.24, 2);
  });

  it("recognises an inset shadow as an inner shadow", () => {
    expect(parseBoxShadow("inset 0px 1px 3px 0px #00000033")[0]?.type).toBe("INNER_SHADOW");
  });

  it("parses every layer of a stack", () => {
    expect(parseBoxShadow("0px 1px 2px 0px #000000, 0px 8px 24px 0px #000000")).toHaveLength(2);
  });

  it("handles negative offsets", () => {
    expect(asShadow(parseBoxShadow("-2px -4px 6px 0px #000000")[0]).offset).toEqual({
      x: -2,
      y: -4,
    });
  });

  it("skips a shadow it cannot parse rather than emitting a wrong one", () => {
    expect(parseBoxShadow("0 8px rgba(0,0,0,0.2)")).toEqual([]);
    expect(parseBoxShadow("")).toEqual([]);
  });
});

describe("resolveVector", () => {
  it("passes raw path data through", () => {
    expect(resolveVector("M0 0 L10 10", tokens())).toBe("M0 0 L10 10");
  });

  it("resolves a $vN ref through the table", () => {
    expect(resolveVector("$v0", tokens({ vector: { $v0: "M1 1" } }))).toBe("M1 1");
  });

  it("returns undefined for an unresolvable ref", () => {
    expect(resolveVector("$v99", tokens())).toBeUndefined();
  });
});

describe("toEmitLayout", () => {
  const layout = (over: Partial<PdsLayout> = {}): PdsLayout => ({
    flow: "col",
    pad: [8, 16, 8, 16],
    ...over,
  });

  it("maps flow to Figma's layout mode", () => {
    expect(toEmitLayout(layout({ flow: "row" })).mode).toBe("HORIZONTAL");
    expect(toEmitLayout(layout({ flow: "col" })).mode).toBe("VERTICAL");
  });

  it("re-labels padding from the CSS tuple to Figma's named sides", () => {
    expect(toEmitLayout(layout()).pad).toEqual({ t: 8, r: 16, b: 8, l: 16 });
  });

  it("maps justify and align onto the primary/counter axis pair", () => {
    const out = toEmitLayout(layout({ justify: "space-between", align: "center" }));
    expect(out.primary).toBe("SPACE_BETWEEN");
    expect(out.counter).toBe("CENTER");
  });

  it("omits axis alignment that the PDS left unset", () => {
    const out = toEmitLayout(layout());
    expect(out).not.toHaveProperty("primary");
    expect(out).not.toHaveProperty("counter");
  });

  it("omits an unset gap but keeps an explicit zero", () => {
    expect(toEmitLayout(layout())).not.toHaveProperty("gap");
    expect(toEmitLayout(layout({ gap: 0 })).gap).toBe(0);
  });

  it("carries wrap and the cross-axis gap", () => {
    const out = toEmitLayout(layout({ flow: "row", wrap: true, gapCross: 12 }));
    expect(out.wrap).toBe(true);
    expect(out.gapCross).toBe(12);
  });
});

describe("resolveLayout", () => {
  it("resolves a $lN ref through the token table", () => {
    const t = tokens({ layout: { $l0: { flow: "row", pad: [0, 0, 0, 0], gap: 8 } } });
    expect(resolveLayout("$l0", t)?.gap).toBe(8);
  });

  it("passes a literal layout through", () => {
    expect(resolveLayout({ flow: "col", pad: [1, 2, 3, 4] }, tokens())?.flow).toBe("col");
  });

  it("returns undefined for an unresolvable ref", () => {
    expect(resolveLayout("$l99", tokens())).toBeUndefined();
  });
});

describe("toChildLayout", () => {
  it("returns undefined for a node with no flex-child intent", () => {
    // Emitting an empty object on every child is how a plan doubles in size
    // while saying nothing.
    expect(toChildLayout(node())).toBeUndefined();
  });

  it("carries grow", () => {
    expect(toChildLayout(node({ grow: 1 }))?.grow).toBe(1);
  });

  it("maps self-alignment", () => {
    expect(toChildLayout(node({ selfAlign: "center" }))?.align).toBe("CENTER");
  });

  it.each([
    ["fill", "FILL"],
    ["hug", "HUG"],
    ["fixed", "FIXED"],
  ] as const)("maps %s sizing to %s on both axes", (pds, figma) => {
    const out = toChildLayout(node({ sizing: { w: pds, h: pds } }));
    expect(out?.sizingH).toBe(figma);
    expect(out?.sizingV).toBe(figma);
  });

  it("emits only the axis that carries intent", () => {
    const out = toChildLayout(node({ sizing: { w: "fill" } }));
    expect(out?.sizingH).toBe("FILL");
    expect(out).not.toHaveProperty("sizingV");
  });

  it("treats grow 0 as no intent", () => {
    expect(toChildLayout(node({ grow: 0 }))).toBeUndefined();
  });
});

describe("faceFor", () => {
  it.each([
    [400, "Regular"],
    [700, "Bold"],
    [600, "Semi Bold"],
    [300, "Light"],
  ])("maps weight %i to the %s style name", (weight, style) => {
    expect(faceFor("Inter", weight)).toEqual({ family: "Inter", style });
  });

  it("buckets an off-scale weight to the nearest hundred", () => {
    // Figma names faces; CSS numbers them. 550 has to become one of them.
    expect(faceFor("Inter", 550).style).toBe(faceFor("Inter", 600).style);
  });

  it("clamps beyond the 100–900 range rather than inventing a face", () => {
    expect(faceFor("Inter", 5).style).toBe(faceFor("Inter", 100).style);
    expect(faceFor("Inter", 5000).style).toBe(faceFor("Inter", 900).style);
  });
});

describe("FontSet", () => {
  it("dedupes by family and style", () => {
    // The executor loads every face BEFORE creating any text node, so this set
    // is the load list — a duplicate is a wasted round trip to Figma.
    const set = new FontSet();
    set.add({ family: "Inter", style: "Regular" });
    set.add({ family: "Inter", style: "Regular" });
    set.add({ family: "Inter", style: "Bold" });
    expect(set.list()).toHaveLength(2);
  });

  it("treats the same style in a different family as distinct", () => {
    const set = new FontSet();
    set.add({ family: "Inter", style: "Regular" });
    set.add({ family: "Roboto", style: "Regular" });
    expect(set.list()).toHaveLength(2);
  });

  it("preserves insertion order", () => {
    const set = new FontSet();
    set.add({ family: "B", style: "Regular" });
    set.add({ family: "A", style: "Regular" });
    expect(set.list().map((f) => f.family)).toEqual(["B", "A"]);
  });

  it("hands out a copy, so a caller cannot mutate the set", () => {
    const set = new FontSet();
    set.add({ family: "Inter", style: "Regular" });
    set.list().push({ family: "Evil", style: "Regular" });
    expect(set.list()).toHaveLength(1);
  });

  it("starts empty", () => {
    expect(new FontSet().list()).toEqual([]);
  });
});

describe("textAutoResize", () => {
  it.each([
    ["h", "HEIGHT"],
    ["wh", "WIDTH_AND_HEIGHT"],
    ["trunc", "TRUNCATE"],
  ] as const)("maps %s to %s", (pds, figma) => {
    expect(textAutoResize(pds)).toBe(figma);
  });

  it("defaults to NONE for an unset or unknown value", () => {
    expect(textAutoResize(undefined)).toBe("NONE");
  });
});

describe("round2", () => {
  it("trims float noise to two places", () => {
    // Figma stores full float precision; 12.000000000000002 in a plan is noise
    // in every diff that ever touches it.
    expect(round2(12.000000000000002)).toBe(12);
    expect(round2(1.005)).toBe(1);
    expect(round2(1.2345)).toBe(1.23);
  });

  it("leaves whole numbers alone", () => {
    expect(round2(42)).toBe(42);
  });

  it("handles negatives", () => {
    expect(round2(-1.239)).toBe(-1.24);
  });
});
