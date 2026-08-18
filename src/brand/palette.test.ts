import { describe, expect, it } from "vitest";
import { synthesizeBrand, synthesizeBrandFromMany, type RawPalette } from "./palette";

/**
 * The brand synthesizer is the write direction's taste. Nothing downstream can
 * recover from a bad palette — every generated surface, label, and button
 * inherits it — and the failure modes are subtle: a muted grey that fails WCAG
 * AA everywhere it renders, a one-off illustration pixel promoted to the brand
 * accent, a hairline border that is actually a stray white rule.
 *
 * The properties below are the ones the heuristics exist to guarantee, so they
 * are asserted as properties (contrast clears AA; the accent is chromatic)
 * rather than as golden hex values that would freeze the tuning.
 */

const empty: RawPalette = { bg: [], text: [], border: [] };

/** WCAG relative-luminance contrast, recomputed independently of the module. */
function contrast(a: string, b: string): number {
  const lum = (hex: string): number => {
    const h = hex.replace("#", "");
    const chan = (i: number): number => {
      const s = parseInt(h.slice(i, i + 2), 16) / 255;
      return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * chan(0) + 0.7152 * chan(2) + 0.0722 * chan(4);
  };
  const la = lum(a) + 0.05;
  const lb = lum(b) + 0.05;
  return la > lb ? la / lb : lb / la;
}

function chroma(hex: string): number {
  const h = hex.replace("#", "");
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)) as [
    number,
    number,
    number,
  ];
  const mx = Math.max(r, g, b);
  return mx === 0 ? 0 : (mx - Math.min(r, g, b)) / mx;
}

const isHex = (s: string): boolean => /^#[0-9a-f]{6}$/i.test(s);

describe("synthesizeBrand", () => {
  const darkSite: RawPalette = {
    bg: [
      { hex: "#0b1120", w: 900000 },
      { hex: "#141c31", w: 200000 },
    ],
    text: [
      { hex: "#f8fafc", w: 40000 },
      { hex: "#94a3b8", w: 20000 },
    ],
    border: [{ hex: "#1e293b", w: 5000 }],
  };

  const lightSite: RawPalette = {
    bg: [
      { hex: "#ffffff", w: 900000 },
      { hex: "#f8fafc", w: 200000 },
    ],
    text: [
      { hex: "#0f172a", w: 40000 },
      { hex: "#64748b", w: 20000 },
    ],
    border: [{ hex: "#e2e8f0", w: 5000 }],
  };

  it("emits every role as a 6-digit hex", () => {
    const brand = synthesizeBrand(darkSite);
    for (const [role, value] of Object.entries(brand)) {
      expect(isHex(value), `${role} = ${value}`).toBe(true);
    }
  });

  it("takes the largest-area background as the ground", () => {
    expect(synthesizeBrand(darkSite).bg).toBe("#0b1120");
    expect(synthesizeBrand(lightSite).bg).toBe("#ffffff");
  });

  it("picks body text that clears WCAG AA on that ground", () => {
    for (const site of [darkSite, lightSite]) {
      const brand = synthesizeBrand(site);
      expect(contrast(brand.text, brand.bg)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("clamps muted text to AA against the LIGHTEST surface it renders on", () => {
    // The bug this guards: muted passes on the page background, then ships
    // failing contrast on every card and elevated surface in the design.
    for (const site of [darkSite, lightSite]) {
      const brand = synthesizeBrand(site);
      expect(contrast(brand.muted, brand.elevated)).toBeGreaterThanOrEqual(4.4);
    }
  });

  it("steps surface and elevated away from the ground, in order", () => {
    const brand = synthesizeBrand(darkSite);
    expect(brand.surface).not.toBe(brand.bg);
    expect(brand.elevated).not.toBe(brand.surface);
    expect(contrast(brand.elevated, brand.bg)).toBeGreaterThan(contrast(brand.surface, brand.bg));
  });

  it("keeps the border a near-neutral hairline, not a full-contrast rule", () => {
    const brand = synthesizeBrand(darkSite);
    expect(contrast(brand.border, brand.bg)).toBeLessThanOrEqual(3);
    expect(chroma(brand.border)).toBeLessThan(0.4);
  });

  it("rejects a sampled border that is really a stray white rule", () => {
    const withStrayRule: RawPalette = { ...darkSite, border: [{ hex: "#ffffff", w: 9000 }] };
    expect(synthesizeBrand(withStrayRule).border).not.toBe("#ffffff");
  });

  it("picks a chromatic accent when the sample contains one", () => {
    const withBrandColor: RawPalette = {
      ...darkSite,
      text: [...darkSite.text, { hex: "#6366f1", w: 30000 }],
    };
    const brand = synthesizeBrand(withBrandColor);
    expect(brand.accent).toBe("#6366f1");
    expect(brand.primary).toBe(brand.accent);
  });

  it("prefers a widely-used brand colour over a one-off illustration pixel", () => {
    // Both are chromatic; only one covers real area.
    const noisy: RawPalette = {
      ...darkSite,
      bg: [...darkSite.bg, { hex: "#6366f1", w: 120000 }],
      border: [...darkSite.border, { hex: "#ff0066", w: 12 }],
    };
    expect(synthesizeBrand(noisy).accent).toBe("#6366f1");
  });

  it("falls back to a usable accent when the sample is entirely grey", () => {
    const brand = synthesizeBrand(darkSite);
    expect(isHex(brand.accent)).toBe(true);
    expect(chroma(brand.accent)).toBeGreaterThan(0.1);
  });

  it("chooses onPrimary for maximum contrast against the accent", () => {
    const brand = synthesizeBrand({
      ...lightSite,
      text: [...lightSite.text, { hex: "#facc15", w: 30000 }],
    });
    // A yellow accent must take dark text, not white.
    expect(contrast(brand.onPrimary, brand.accent)).toBeGreaterThan(
      contrast(brand.onPrimary === "#FFFFFF" ? "#0A0A0B" : "#FFFFFF", brand.accent),
    );
  });

  it("produces a complete brand from an entirely empty sample", () => {
    // A reference site that blocked the sampler must not produce undefined
    // roles downstream.
    const brand = synthesizeBrand(empty);
    for (const value of Object.values(brand)) expect(isHex(value)).toBe(true);
  });
});

describe("synthesizeBrandFromMany", () => {
  const dark = (bg: string, text: string): RawPalette => ({
    bg: [{ hex: bg, w: 900000 }],
    text: [{ hex: text, w: 40000 }],
    border: [],
  });

  it("delegates to the single-site path for zero or one reference", () => {
    expect(synthesizeBrandFromMany([])).toEqual(synthesizeBrand(empty));
    const one = dark("#0b1120", "#f8fafc");
    expect(synthesizeBrandFromMany([one])).toEqual(synthesizeBrand(one));
  });

  it("resolves light-vs-dark by majority vote, not by the first reference", () => {
    const brand = synthesizeBrandFromMany([
      dark("#ffffff", "#0f172a"),
      dark("#0b1120", "#f8fafc"),
      dark("#111827", "#f9fafb"),
    ]);
    // Two of three are dark, and the first reference is light.
    expect(contrast(brand.bg, "#ffffff")).toBeGreaterThan(4.5);
  });

  it("takes the median background within the winning mode, ignoring outliers", () => {
    const brand = synthesizeBrandFromMany([
      dark("#000000", "#ffffff"),
      dark("#0b1120", "#f8fafc"),
      dark("#1a1a2e", "#f4f4f5"),
    ]);
    expect(brand.bg).toBe("#0b1120");
  });

  it("still guarantees AA for text and muted across the blend", () => {
    const brand = synthesizeBrandFromMany([
      dark("#0b1120", "#f8fafc"),
      dark("#111827", "#f9fafb"),
      dark("#0f0f14", "#eeeeee"),
    ]);
    expect(contrast(brand.text, brand.bg)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(brand.muted, brand.elevated)).toBeGreaterThanOrEqual(4.4);
  });

  it("picks the accent hue the references agree on, not one site's loudest pixel", () => {
    const withAccent = (accent: string, w: number): RawPalette => ({
      bg: [{ hex: "#0b1120", w: 900000 }],
      text: [
        { hex: "#f8fafc", w: 40000 },
        { hex: accent, w },
      ],
      border: [],
    });
    // Equal chroma on both sides, so the hue-bucket sum is what decides —
    // otherwise this would only be re-testing that saturated beats muted.
    const brand = synthesizeBrandFromMany([
      withAccent("#6600ff", 40000), // violet, hue ~264°
      withAccent("#7a1aff", 40000), // violet, same 30° bucket
      withAccent("#ff0066", 50000), // one louder pink, hue ~336°, alone
    ]);
    // Two references agree on violet; the pink covers more area in its one
    // reference but has no bucket-mate to add to.
    expect(chroma(brand.accent)).toBeGreaterThan(0.3);
    expect(brand.accent.toLowerCase()).not.toBe("#ff0066");
  });

  it("emits every role as a hex for a mixed set of references", () => {
    const brand = synthesizeBrandFromMany([
      dark("#ffffff", "#0f172a"),
      dark("#0b1120", "#f8fafc"),
    ]);
    for (const [role, value] of Object.entries(brand)) {
      expect(isHex(value), `${role} = ${value}`).toBe(true);
    }
  });
});
