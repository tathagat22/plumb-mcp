/**
 * Canonical asset-engine types (blueprint §8, §10).
 *
 * `AssetKind`/`StyleTag`/`IconWeight` here are the SUPERSET source of truth;
 * `src/dsl/schema.ts` keeps a hand-mirrored copy (schema.ts must stay
 * standalone — zod-only — so it cannot import this file). Keep the two
 * literal unions in sync when either changes.
 *
 * This file has ZERO imports from the rest of the app on purpose: every
 * provider file (and the future search/rank/registerAsset orchestration)
 * depends on it, so it must never itself depend on anything that could
 * create a cycle.
 */

// ============================================================================
// Mirrors of src/dsl/schema.ts's AssetKind / StyleTag / IconWeight
// ============================================================================

export type AssetKind =
  | "icon"
  | "photo"
  | "illustration"
  | "avatar"
  | "pattern"
  | "font"
  | "mockup"
  | "logo"
  | "generated";

export type StyleTag =
  | "flat"
  | "line"
  | "outline"
  | "filled"
  | "duotone"
  | "3d"
  | "photo"
  | "illustration"
  | "hand-drawn"
  | "geometric"
  | "gradient";

export type IconWeight = "thin" | "light" | "regular" | "medium" | "bold";

// ============================================================================
// Licensing
// ============================================================================

/** A license attached to a candidate/fetched asset. Hard-gates provider use. */
export interface LicenseRef {
  /** Stable id, e.g. "unsplash", "pexels", "cc0", "iconify:mdi". */
  id: string;
  name: string;
  url?: string;
  requiresAttribution: boolean;
  /** Suggested attribution string when `requiresAttribution` is true. */
  attributionTemplate?: string;
  commercial: boolean;
}

/** Reusable license presets so providers don't hand-roll strings. */
export const LICENSES = {
  iconify: {
    id: "iconify",
    name: "Open-source icon (varies by set, see icon-sets.iconify.design)",
    url: "https://iconify.design/license/",
    requiresAttribution: false,
    commercial: true,
  } satisfies LicenseRef,
  unsplash: {
    id: "unsplash",
    name: "Unsplash License",
    url: "https://unsplash.com/license",
    requiresAttribution: false,
    attributionTemplate: "Photo by {author} on Unsplash",
    commercial: true,
  } satisfies LicenseRef,
  pexels: {
    id: "pexels",
    name: "Pexels License",
    url: "https://www.pexels.com/license/",
    requiresAttribution: false,
    attributionTemplate: "Photo by {author} on Pexels",
    commercial: true,
  } satisfies LicenseRef,
  pixabay: {
    id: "pixabay",
    name: "Pixabay Content License",
    url: "https://pixabay.com/service/license-summary/",
    requiresAttribution: false,
    attributionTemplate: "Image by {author} on Pixabay",
    commercial: true,
  } satisfies LicenseRef,
  picsum: {
    id: "picsum",
    name: "Lorem Picsum (Unsplash-sourced placeholder photos)",
    url: "https://picsum.photos/",
    requiresAttribution: false,
    commercial: true,
  } satisfies LicenseRef,
  dicebear: {
    id: "dicebear",
    name: "DiceBear Avatars (CC0 / MIT per style, see dicebear.com/licenses)",
    url: "https://www.dicebear.com/licenses/",
    requiresAttribution: false,
    commercial: true,
  } satisfies LicenseRef,
  googleFonts: {
    id: "google-fonts",
    name: "Open font license (OFL/Apache-2.0, varies per family)",
    url: "https://fonts.google.com/attribution",
    requiresAttribution: false,
    commercial: true,
  } satisfies LicenseRef,
  /** Placeholder art authored fresh for Plumb (illustrations/mockups/patterns
   *  bundled providers) — never a traced/derived copy of a third-party set,
   *  so it carries no third-party license obligation. */
  bundled: {
    id: "plumb-bundled",
    name: "CC0 — bundled with Plumb",
    requiresAttribution: false,
    commercial: true,
  } satisfies LicenseRef,
} as const;

// ============================================================================
// Search → fetch pipeline shapes
// ============================================================================

/** A ranked search hit. Cheap (metadata + a `raw` provider payload); no
 *  bytes yet — `AssetProvider.fetch` turns one of these into a `FetchedAsset`. */
export interface AssetCandidate {
  /** Provider-scoped id (e.g. `"mdi:home"`, an Unsplash photo id). */
  id: string;
  provider: string;
  kind: AssetKind;
  title?: string;
  tags?: string[];
  width?: number;
  height?: number;
  /** Small preview for a picker UI; never the asset itself. */
  previewUrl?: string;
  sourceUrl?: string;
  author?: string;
  authorUrl?: string;
  license: LicenseRef;
  /** Higher is better; providers set a relative ranking, rank.ts may rescale. */
  score?: number;
  /** Opaque provider-internal payload carried through to `fetch()` — MUST be
   *  self-sufficient (fetch never re-runs search). */
  raw?: unknown;
}

/** Bytes (or an inline SVG string, or a vector path) for one resolved asset.
 *  Exactly one of `bytes` / `svg` / `vectorPath` should be set, per `kind`. */
export interface FetchedAsset {
  bytes?: Uint8Array;
  /** Inline SVG markup (icons, illustrations, patterns, mockup frames). */
  svg?: string;
  /** A single `<path d="…">` value — used when the caller wants a Figma
   *  VECTOR node instead of a rasterized/embedded image (icons only). */
  vectorPath?: string;
  mime: string;
  ext: string;
  width?: number;
  height?: number;
  kind: AssetKind;
  license: LicenseRef;
  attribution?: string;
  sourceUrl?: string;
}

// ============================================================================
// Device mockups
// ============================================================================

export type MockupDevice = "phone" | "tablet" | "laptop" | "browser" | "watch";

/** A bundled device-frame template. `frameSvg` contains a single element with
 *  `id="plumb-content-slot"` (a `<rect>`) marking where screenshot content
 *  should be composited/clipped; `contentRect` gives that same rect in the
 *  frame's own viewBox units so callers can composite without re-parsing SVG. */
export interface MockupRecipe {
  id: string;
  label: string;
  device: MockupDevice;
  canvasW: number;
  canvasH: number;
  contentRect: { x: number; y: number; w: number; h: number };
  frameSvg: string;
}

// ============================================================================
// Fonts
// ============================================================================

export interface FontMeta {
  family: string;
  category?: "serif" | "sans-serif" | "display" | "handwriting" | "monospace";
  variants?: string[];
  subsets?: string[];
  /** Keyless `css2` stylesheet URL — resolves to `@font-face` rules with
   *  hosted `.woff2` file URLs; no API key required. */
  cssUrl: string;
}
