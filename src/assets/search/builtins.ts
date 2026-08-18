/**
 * The built-in, keyless-first providers, and the registry they live in.
 *
 * iconify / picsum / dicebear always work with no configuration. The keyed
 * photo providers (unsplash / pexels / pixabay) silently DROP themselves when
 * their env key is absent — a missing key is never an error, it just means
 * fewer candidates.
 */

import type { StyleTag } from "../../dsl/schema";
import type { AssetCandidate, AssetProvider, AssetSearchContext } from "./contracts";
import { fetchBitmap, fetchSvg, httpJson } from "./fetch";
import { PREFIX_STYLE, tokenize } from "./rank";

// ============================================================================
// Built-in providers (keyless-first)
// ============================================================================

export function keyPresent(ctx: AssetSearchContext, key?: string): boolean {
  return !!key && typeof ctx.env[key] === "string" && ctx.env[key]!.length > 0;
}

/** Style tags implied by an iconify prefix, for candidate hints. */
export function stylesForPrefix(prefix: string): StyleTag[] | undefined {
  return PREFIX_STYLE[prefix];
}

/** Iconify — keyless, 200k+ icons, unified search + per-icon SVG. */
export const iconifyProvider: AssetProvider = {
  id: "iconify",
  kinds: ["icon"],
  keyless: true,
  async search(spec, ctx) {
    if (spec.kind && spec.kind !== "icon") return [];
    const q = encodeURIComponent(spec.query);
    const data = await httpJson<{ icons?: string[] }>(
      `https://api.iconify.design/search?query=${q}&limit=${ctx.perProvider}`,
      ctx,
    );
    const icons = data.icons ?? [];
    const color = spec.palette?.[0];
    return icons.map((full): AssetCandidate => {
      const idx = full.indexOf(":");
      const prefix = idx >= 0 ? full.slice(0, idx) : full;
      const name = idx >= 0 ? full.slice(idx + 1) : full;
      const svgUrl =
        `https://api.iconify.design/${prefix}/${name}.svg` +
        (color ? `?color=${encodeURIComponent(color)}` : "");
      return {
        id: full,
        provider: "iconify",
        kind: "icon",
        title: name.replace(/-/g, " "),
        tags: [prefix, ...name.split("-")],
        style: stylesForPrefix(prefix),
        license: "Iconify — per-set (mostly permissive)",
        fetch: (c) => fetchSvg(svgUrl, c),
      };
    });
  },
};

export const DICEBEAR_STYLES = [
  "lorelei",
  "thumbs",
  "notionists",
  "avataaars",
  "bottts",
  "fun-emoji",
  "identicon",
  "initials",
  "shapes",
] as const;

/** DiceBear — keyless deterministic avatars (seed-based). */
export const dicebearProvider: AssetProvider = {
  id: "dicebear",
  kinds: ["avatar"],
  keyless: true,
  async search(spec, ctx) {
    if (spec.kind && spec.kind !== "avatar") return [];
    const seed = encodeURIComponent(spec.seed ?? spec.query ?? "plumb");
    // Rank a curated style shortlist; the query words nudge the style choice.
    const qs = tokenize(spec.query);
    const ordered = [...DICEBEAR_STYLES].sort((a, b) => {
      const sa = qs.includes(a) ? 1 : 0;
      const sb = qs.includes(b) ? 1 : 0;
      return sb - sa;
    });
    return ordered.slice(0, Math.min(ctx.perProvider, ordered.length)).map(
      (style): AssetCandidate => {
        const url = `https://api.dicebear.com/9.x/${style}/svg?seed=${seed}`;
        return {
          id: `dicebear:${style}:${seed}`,
          provider: "dicebear",
          kind: "avatar",
          title: `${style} avatar`,
          tags: ["avatar", style, ...qs],
          license: "DiceBear — per-style (mostly CC0 / free)",
          fetch: (c) => fetchSvg(url, c),
        };
      },
    );
  },
};

/** Lorem Picsum — keyless deterministic photo fallback. */
export const picsumProvider: AssetProvider = {
  id: "picsum",
  kinds: ["photo"],
  keyless: true,
  async search(spec, ctx) {
    if (spec.kind && spec.kind !== "photo") return [];
    void ctx;
    const w = spec.w ?? spec.minWidth ?? 1200;
    const h = spec.h ?? (spec.aspect ? Math.round(w / spec.aspect) : Math.round(w * 0.66));
    const seed = encodeURIComponent(spec.seed ?? spec.query ?? "plumb");
    const url = `https://picsum.photos/seed/${seed}/${w}/${h}`;
    return [
      {
        id: `picsum:${seed}:${w}x${h}`,
        provider: "picsum",
        kind: "photo",
        title: spec.query || "photo",
        tags: ["photo", "placeholder"],
        w,
        h,
        url,
        scaleMode: "fill",
        license: "Lorem Picsum — Unsplash License (free)",
        fetch: (c) => fetchBitmap(url, c, "jpg"),
      },
    ];
  },
};

/** Unsplash — keyed; drops silently when UNSPLASH_ACCESS_KEY is absent. */
export const unsplashProvider: AssetProvider = {
  id: "unsplash",
  kinds: ["photo"],
  keyless: false,
  envKey: "UNSPLASH_ACCESS_KEY",
  available: (ctx) => keyPresent(ctx, "UNSPLASH_ACCESS_KEY"),
  async search(spec, ctx) {
    if (spec.kind && spec.kind !== "photo") return [];
    const key = ctx.env.UNSPLASH_ACCESS_KEY!;
    const q = encodeURIComponent(spec.query);
    const data = await httpJson<{
      results?: {
        id: string;
        width?: number;
        height?: number;
        alt_description?: string;
        description?: string;
        urls?: { regular?: string; full?: string; small?: string };
        user?: { name?: string };
      }[];
    }>(
      `https://api.unsplash.com/search/photos?query=${q}&per_page=${ctx.perProvider}`,
      ctx,
      { authorization: `Client-ID ${key}` },
    );
    return (data.results ?? []).map((r): AssetCandidate => {
      const url = r.urls?.regular ?? r.urls?.full ?? r.urls?.small ?? "";
      return {
        id: `unsplash:${r.id}`,
        provider: "unsplash",
        kind: "photo",
        title: r.alt_description ?? r.description ?? spec.query,
        tags: tokenize(`${r.alt_description ?? ""} ${r.description ?? ""}`),
        w: r.width,
        h: r.height,
        url,
        thumbUrl: r.urls?.small,
        scaleMode: "fill",
        license: "Unsplash License",
        attribution: r.user?.name ? `Photo by ${r.user.name} on Unsplash` : undefined,
        fetch: (c) => fetchBitmap(url, c, "jpg"),
      };
    });
  },
};

/** Pexels — keyed; drops silently when PEXELS_API_KEY is absent. */
export const pexelsProvider: AssetProvider = {
  id: "pexels",
  kinds: ["photo"],
  keyless: false,
  envKey: "PEXELS_API_KEY",
  available: (ctx) => keyPresent(ctx, "PEXELS_API_KEY"),
  async search(spec, ctx) {
    if (spec.kind && spec.kind !== "photo") return [];
    const key = ctx.env.PEXELS_API_KEY!;
    const q = encodeURIComponent(spec.query);
    const data = await httpJson<{
      photos?: {
        id: number;
        width?: number;
        height?: number;
        alt?: string;
        photographer?: string;
        src?: { original?: string; large2x?: string; large?: string; medium?: string };
      }[];
    }>(
      `https://api.pexels.com/v1/search?query=${q}&per_page=${ctx.perProvider}`,
      ctx,
      { authorization: key },
    );
    return (data.photos ?? []).map((p): AssetCandidate => {
      const url = p.src?.large ?? p.src?.large2x ?? p.src?.medium ?? p.src?.original ?? "";
      return {
        id: `pexels:${p.id}`,
        provider: "pexels",
        kind: "photo",
        title: p.alt ?? spec.query,
        tags: tokenize(p.alt ?? ""),
        w: p.width,
        h: p.height,
        url,
        scaleMode: "fill",
        license: "Pexels License",
        attribution: p.photographer ? `Photo by ${p.photographer} on Pexels` : undefined,
        fetch: (c) => fetchBitmap(url, c, "jpg"),
      };
    });
  },
};

/** Pixabay — keyed; drops silently when PIXABAY_API_KEY is absent. */
export const pixabayProvider: AssetProvider = {
  id: "pixabay",
  kinds: ["photo", "illustration"],
  keyless: false,
  envKey: "PIXABAY_API_KEY",
  available: (ctx) => keyPresent(ctx, "PIXABAY_API_KEY"),
  async search(spec, ctx) {
    if (spec.kind && spec.kind !== "photo" && spec.kind !== "illustration") return [];
    const key = ctx.env.PIXABAY_API_KEY!;
    const q = encodeURIComponent(spec.query);
    const imageType =
      spec.kind === "illustration" ? "illustration" : "photo";
    const data = await httpJson<{
      hits?: {
        id: number;
        imageWidth?: number;
        imageHeight?: number;
        tags?: string;
        user?: string;
        webformatURL?: string;
        largeImageURL?: string;
      }[];
    }>(
      `https://pixabay.com/api/?key=${encodeURIComponent(key)}&q=${q}` +
        `&image_type=${imageType}&per_page=${Math.max(3, ctx.perProvider)}`,
      ctx,
    );
    return (data.hits ?? []).map((hh): AssetCandidate => {
      const url = hh.largeImageURL ?? hh.webformatURL ?? "";
      return {
        id: `pixabay:${hh.id}`,
        provider: "pixabay",
        kind: imageType === "illustration" ? "illustration" : "photo",
        title: hh.tags ?? spec.query,
        tags: tokenize(hh.tags ?? ""),
        w: hh.imageWidth,
        h: hh.imageHeight,
        url,
        scaleMode: "fill",
        license: "Pixabay Content License",
        attribution: hh.user ? `Image by ${hh.user} on Pixabay` : undefined,
        fetch: (c) => fetchBitmap(url, c, "jpg"),
      };
    });
  },
};

export const BUILTIN_PROVIDERS: AssetProvider[] = [
  iconifyProvider,
  dicebearProvider,
  unsplashProvider,
  pexelsProvider,
  pixabayProvider,
  picsumProvider,
];

export const registry = new Map<string, AssetProvider>(
  BUILTIN_PROVIDERS.map((p) => [p.id, p]),
);

/** Register / override a provider (the asset-providers task hooks its own here). */
export function registerAssetProvider(provider: AssetProvider): void {
  registry.set(provider.id, provider);
}

/** All currently-registered providers. */
export function listAssetProviders(): AssetProvider[] {
  return [...registry.values()];
}

/**
 * The `illustration`/`mockup`/`pattern` providers live in `./providers/*` and
 * must be bridged in via `registerBundledAssetProviders()`. Lazily import + run
 * that once (dynamic import avoids a top-level cycle with `providers/register`,
 * which imports from this file). Idempotent; never throws — a failure here just
 * means those extra kinds are unavailable, not that search breaks.
 */
let _bundledReady: Promise<void> | null = null;
export function ensureBundledProviders(): Promise<void> {
  if (!_bundledReady) {
    _bundledReady = import("../providers/register")
      .then((m) => m.registerBundledAssetProviders())
      .catch(() => {
        /* extra providers optional; keep search working with the built-ins */
      });
  }
  return _bundledReady;
}

export function isAvailable(p: AssetProvider, ctx: AssetSearchContext): boolean {
  if (p.available) return p.available(ctx);
  return p.keyless || keyPresent(ctx, p.envKey);
}
