import { describe, expect, it } from "vitest";
import type { PdsNode } from "../pds";
import { isUserAgentColor, parseColor, pushColorDelta } from "./color";
import { DEFAULT_TOLERANCES, type Delta } from "./types";

/**
 * Colour is where "close enough" has to be defined precisely. The thresholds
 * are ΔE2000, so the tests that matter are the ones that pin the boundary
 * between "a human would never see this" and "that's the wrong blue" — plus
 * the parser's refusal to invent a colour it didn't recognise.
 */

const node = (over: Partial<PdsNode> = {}): PdsNode => ({
  id: "1:1",
  el: "box",
  type: "frame",
  box: { w: 100, h: 40 },
  ...over,
});

describe("parseColor", () => {
  it("parses 6-digit hex", () => {
    expect(parseColor("#6366f1")).toEqual({ r: 99, g: 102, b: 241, a: 1 });
  });

  it("expands 3-digit hex", () => {
    expect(parseColor("#f0a")).toEqual({ r: 255, g: 0, b: 170, a: 1 });
  });

  it("parses 8-digit hex with alpha", () => {
    const c = parseColor("#00000080");
    expect(c).toMatchObject({ r: 0, g: 0, b: 0 });
    expect(c!.a).toBeCloseTo(0.5, 2);
  });

  it("expands 4-digit hex with alpha", () => {
    const c = parseColor("#0008");
    expect(c!.a).toBeCloseTo(0.53, 2);
  });

  it("parses the rgb()/rgba() forms a browser actually reports", () => {
    expect(parseColor("rgb(99, 102, 241)")).toEqual({ r: 99, g: 102, b: 241, a: 1 });
    expect(parseColor("rgba(0, 0, 0, 0.24)")).toEqual({ r: 0, g: 0, b: 0, a: 0.24 });
  });

  it("parses the space/slash rgb() syntax", () => {
    expect(parseColor("rgb(99 102 241 / 0.5)")).toEqual({ r: 99, g: 102, b: 241, a: 0.5 });
  });

  it("is case-insensitive and tolerates surrounding whitespace", () => {
    expect(parseColor("  #6366F1 ")).toEqual({ r: 99, g: 102, b: 241, a: 1 });
  });

  it.each([undefined, "", "transparent", "none", "currentColor"])(
    "returns null for %s — absence of colour, not black",
    (input) => {
      expect(parseColor(input)).toBeNull();
    },
  );

  it.each(["#12345", "#gggggg", "hsl(220, 90%, 60%)", "rebeccapurple"])(
    "returns null for %s rather than guessing",
    (input) => {
      expect(parseColor(input)).toBeNull();
    },
  );
});

describe("pushColorDelta", () => {
  function deltasFor(expected: string, actual: string): Delta[] {
    const out: Delta[] = [];
    pushColorDelta(node(), "fill", expected, actual, DEFAULT_TOLERANCES, out);
    return out;
  }

  it("stays silent on an exact match", () => {
    expect(deltasFor("#6366f1", "rgb(99, 102, 241)")).toEqual([]);
  });

  it("stays silent on a difference below the just-noticeable threshold", () => {
    // One unit off in one channel — nobody can see this, and flagging it would
    // bury the real findings.
    expect(deltasFor("#6366f1", "rgb(99, 102, 242)")).toEqual([]);
  });

  it("reports an error for a clearly different colour", () => {
    const deltas = deltasFor("#6366f1", "rgb(124, 92, 245)");
    expect(deltas).toHaveLength(1);
    expect(deltas[0]).toMatchObject({ el: "box", kind: "fill", severity: "error" });
    expect(deltas[0]!.expected).toBe("#6366f1");
  });

  it("reports the actual colour back as hex, whatever form it arrived in", () => {
    const deltas = deltasFor("#6366f1", "rgb(124, 92, 245)");
    expect(deltas[0]!.actual).toBe("#7c5cf5");
  });

  it("carries a numeric ΔE distance so the caller can rank findings", () => {
    const deltas = deltasFor("#6366f1", "rgb(220, 38, 38)");
    expect(deltas[0]!.diff).toBeGreaterThan(3.5);
  });

  it("stays silent when either side is unparseable", () => {
    // No colour is better than a fabricated one — an unknown value must not
    // become a delta against the user's build.
    expect(deltasFor("#6366f1", "hsl(220, 90%, 60%)")).toEqual([]);
    expect(deltasFor("not-a-colour", "rgb(0,0,0)")).toEqual([]);
    expect(deltasFor("#6366f1", "transparent")).toEqual([]);
  });

  it("carries the node name through when the layer had a descriptive one", () => {
    const out: Delta[] = [];
    pushColorDelta(
      node({ name: "Primary CTA" }),
      "fill",
      "#6366f1",
      "rgb(220, 38, 38)",
      DEFAULT_TOLERANCES,
      out,
    );
    expect(out[0]!.name).toBe("Primary CTA");
  });
});

describe("isUserAgentColor", () => {
  it.each(["buttonface", "ButtonFace", "field", "buttontext"])(
    "recognises the UA keyword %s",
    (input) => {
      // A computed background of `buttonface` means the agent's reset isn't
      // taking and the browser is painting a native control.
      expect(isUserAgentColor(input)).toBe(true);
    },
  );

  it.each(["rgb(99, 102, 241)", "#6366f1", "transparent", ""])(
    "does not flag the ordinary value %s",
    (input) => {
      expect(isUserAgentColor(input)).toBe(false);
    },
  );
});
