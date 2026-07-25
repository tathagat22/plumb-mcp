import { describe, expect, it } from "vitest";
import { googleFontsLinkUrl, isKnownGoogleFont } from "./fonts";

describe("isKnownGoogleFont — Phase F3", () => {
  it("matches a curated family case-insensitively, trimmed", () => {
    expect(isKnownGoogleFont("Inter")).toBe(true);
    expect(isKnownGoogleFont("inter")).toBe(true);
    expect(isKnownGoogleFont("  Inter  ")).toBe(true);
  });

  it("does not match a family outside the curated manifest", () => {
    expect(isKnownGoogleFont("Helvetica Neue")).toBe(false);
    expect(isKnownGoogleFont("SF Pro Display")).toBe(false);
  });
});

describe("googleFontsLinkUrl — Phase F3", () => {
  it("builds a css2 URL for the given family with the default weight axis", () => {
    const url = googleFontsLinkUrl("Inter");
    expect(url).toContain("fonts.googleapis.com/css2");
    expect(url).toContain("family=Inter");
    expect(url).toContain("400;500;600;700");
  });

  it("URL-encodes a multi-word family with + separators", () => {
    const url = googleFontsLinkUrl("Space Grotesk");
    expect(url).toContain("family=Space+Grotesk");
  });
});
