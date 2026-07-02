/**
 * Unified asset search + fetch layer.
 *
 * This is the "source assets" engine the write direction consumes: given a
 * semantic {@link AssetSpec} (query / kind / style / weight …), it queries every
 * registered provider in parallel, ranks the candidates with a single scoring
 * function (including the pick-the-right-icon-pack heuristic so a design uses ONE
 * consistent icon family), then fetches the winner's bytes and returns a
 * {@link ResolvedAsset}.
 *
 * Design rules honoured (docs/plumb-design-blueprint.md §8):
 *   - Keyless-first: iconify / picsum / dicebear always work; keyed photo
 *     providers (unsplash / pexels / pixabay) silently DROP when their env key is
 *     absent — a missing key is never an error.
 *   - Server-side egress only: providers fetch over the public internet from the
 *     Node process; the plugin never talks to a provider domain.
 *   - Never throw: every provider call and fetch is guarded; a total miss
 *     degrades to a deterministic placeholder so the caller (the DSL compiler)
 *     can keep going.
 *
 * Standalone by design: this file imports ONLY the locked type contracts from
 * `../dsl/schema` (AssetSpec / ResolvedAsset / AssetKind / StyleTag / IconWeight /
 * AssetResolver). The `AssetProvider` registry below is local + pluggable via
 * {@link registerAssetProvider}, so the asset-providers task can add the bundled
 * SVG / mockup / font providers without touching this file.
 */

import type {
  AssetKind,
  AssetResolver,
  AssetSpec,
  IconWeight,
  ResolvedAsset,
  StyleTag,
} from "../dsl/schema";

// ============================================================================
// Public types
// ============================================================================

export type AssetExt = "png" | "jpg" | "webp" | "gif" | "svg";

const EXT_MIME: Record<AssetExt, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
  svg: "image/svg+xml",
};

/** Raw bytes returned by a provider fetch, before disk/staging. */
export interface FetchedBytes {
  bytes: Uint8Array;
  ext: AssetExt;
  mime: string;
  /** Present for SVGs — the markup, so small vectors can be inlined. */
  svgText?: string;
}

/**
 * A search hit — everything needed to rank it, plus a `fetch` thunk that pulls
 * the actual bytes only for the candidate(s) the caller keeps. Closures keep
 * the fetch logic co-located with the provider that knows how to build the URL.
 */
export interface AssetCandidate {
  /** Provider-scoped stable id, e.g. `"mdi:home"` or `"unsplash:abc123"`. */
  id: string;
  provider: string;
  kind: AssetKind;
  title?: string;
  tags?: string[];
  style?: StyleTag[];
  weight?: IconWeight;
  /** Source / preview URL (also used for attribution links). */
  url?: string;
  thumbUrl?: string;
  w?: number;
  h?: number;
  license?: string;
  attribution?: string;
  scaleMode?: ResolvedAsset["scaleMode"];
  /** Filled by {@link rankCandidates}; higher is better. */
  score?: number;
  /** Pull the bytes. Guarded by callers; may reject. */
  fetch: (ctx: AssetSearchContext) => Promise<FetchedBytes>;
}

/** Ambient context threaded into every provider call. */
export interface AssetSearchContext {
  env: NodeJS.ProcessEnv;
  /** Per-request network timeout. */
  timeoutMs: number;
  /** Cap on candidates a single provider returns. */
  perProvider: number;
}

export interface AssetProvider {
  id: string;
  /** Kinds this provider can serve. */
  kinds: AssetKind[];
  /** True when it works with no API key. */
  keyless: boolean;
  /** Env var that unlocks a keyed provider. */
  envKey?: string;
  /** Default availability = keyless OR the env key is present. Overridable. */
  available?: (ctx: AssetSearchContext) => boolean;
  search: (spec: AssetSpec, ctx: AssetSearchContext) => Promise<AssetCandidate[]>;
}

export interface SearchOptions {
  limit?: number;
  timeoutMs?: number;
  perProvider?: number;
  env?: NodeJS.ProcessEnv;
}

export interface SearchResult {
  candidates: AssetCandidate[];
  /** Provider ids that actually ran. */
  providersRun: string[];
  /** `{id, reason}` for providers skipped (no key / kind mismatch / errored). */
  providersDropped: { id: string; reason: string }[];
  /** For icons: the single pack the ranking locked onto, if any. */
  iconPack?: string;
}

/** A {@link ResolvedAsset} plus the bytes, so the caller can write / stage them. */
export interface SourcedAsset extends ResolvedAsset {
  bytes?: Uint8Array;
  ext?: AssetExt;
  mime?: string;
  provider?: string;
  title?: string;
  attribution?: string;
  license?: string;
  /** True when we fell back to a deterministic placeholder. */
  placeholder?: boolean;
}

const DEFAULTS = { limit: 16, timeoutMs: 10_000, perProvider: 24 } as const;

// ============================================================================
// HTTP helpers (server-side egress; guarded with an abort timeout)
// ============================================================================

async function httpJson<T>(
  url: string,
  ctx: AssetSearchContext,
  headers?: Record<string, string>,
): Promise<T> {
  const res = await fetch(url, {
    signal: AbortSignal.timeout(ctx.timeoutMs),
    headers: { "user-agent": "plumb-mcp", accept: "application/json", ...headers },
  });
  if (!res.ok) throw new Error(`GET ${url} → ${res.status}`);
  return (await res.json()) as T;
}

async function httpBytes(
  url: string,
  ctx: AssetSearchContext,
  headers?: Record<string, string>,
): Promise<{ bytes: Uint8Array; contentType: string }> {
  const res = await fetch(url, {
    signal: AbortSignal.timeout(ctx.timeoutMs),
    headers: { "user-agent": "plumb-mcp", ...headers },
  });
  if (!res.ok) throw new Error(`GET ${url} → ${res.status}`);
  const buf = new Uint8Array(await res.arrayBuffer());
  return { bytes: buf, contentType: res.headers.get("content-type") ?? "" };
}

function extFromContentType(ct: string, fallback: AssetExt): AssetExt {
  const c = ct.toLowerCase();
  if (c.includes("svg")) return "svg";
  if (c.includes("png")) return "png";
  if (c.includes("webp")) return "webp";
  if (c.includes("gif")) return "gif";
  if (c.includes("jpeg") || c.includes("jpg")) return "jpg";
  return fallback;
}

/** Fetch a bitmap URL into {@link FetchedBytes}. */
async function fetchBitmap(
  url: string,
  ctx: AssetSearchContext,
  fallbackExt: AssetExt = "jpg",
): Promise<FetchedBytes> {
  const { bytes, contentType } = await httpBytes(url, ctx);
  const ext = extFromContentType(contentType, fallbackExt);
  return { bytes, ext, mime: EXT_MIME[ext] };
}

/** Fetch an SVG URL as both bytes and markup (so it can be inlined). */
async function fetchSvg(url: string, ctx: AssetSearchContext): Promise<FetchedBytes> {
  const res = await fetch(url, {
    signal: AbortSignal.timeout(ctx.timeoutMs),
    headers: { "user-agent": "plumb-mcp", accept: "image/svg+xml" },
  });
  if (!res.ok) throw new Error(`GET ${url} → ${res.status}`);
  const svgText = await res.text();
  return {
    bytes: new TextEncoder().encode(svgText),
    ext: "svg",
    mime: EXT_MIME.svg,
    svgText,
  };
}

// ============================================================================
// Ranking — one scoring function for every provider
// ============================================================================

const PROVIDER_RANK: Record<string, number> = {
  iconify: 0.9,
  unsplash: 0.9,
  pexels: 0.85,
  pixabay: 0.8,
  dicebear: 0.8,
  picsum: 0.4,
};

/** Iconify prefixes → the style family they read as, for weight/style affinity. */
const PREFIX_STYLE: Record<string, StyleTag[]> = {
  ph: ["line", "duotone", "outline"],
  lucide: ["line", "outline"],
  tabler: ["line", "outline"],
  "mdi-light": ["line", "outline"],
  mdi: ["filled", "flat"],
  "material-symbols": ["filled", "outline"],
  "material-symbols-light": ["outline", "line"],
  carbon: ["line", "outline"],
  solar: ["line", "duotone", "filled"],
  "fluent-emoji": ["3d"],
  "fluent-emoji-flat": ["flat"],
  noto: ["3d"],
  "twemoji": ["flat"],
  heroicons: ["outline", "filled", "line"],
  "heroicons-outline": ["outline", "line"],
  "heroicons-solid": ["filled"],
  bi: ["filled", "line"],
  fa6: ["filled"],
  "fa6-regular": ["outline", "line"],
};

function tokenize(s: string): string[] {
  return s.toLowerCase().match(/[a-z0-9]+/g) ?? [];
}

/** Fraction of `needles` present in `haystack`. */
function overlap(needles: string[], haystack: Set<string>): number {
  if (needles.length === 0) return 0;
  let hit = 0;
  for (const n of needles) if (haystack.has(n)) hit++;
  return hit / needles.length;
}

/** Score a single candidate against the spec (roughly 0..1.2). */
export function scoreCandidate(c: AssetCandidate, spec: AssetSpec): number {
  const q = tokenize(spec.query);
  const hay = new Set(
    tokenize([c.title ?? "", (c.tags ?? []).join(" "), c.id].join(" ")),
  );
  let s = 0.45 * overlap(q, hay);

  if (spec.kind) s += c.kind === spec.kind ? 0.2 : -0.15;

  if (spec.style?.length && c.style?.length) {
    const cs = new Set(c.style as string[]);
    let so = 0;
    for (const want of spec.style) if (cs.has(want)) so++;
    s += 0.15 * (so / spec.style.length);
  }

  if (spec.weight && c.weight) s += c.weight === spec.weight ? 0.08 : 0;

  if (spec.aspect && c.w && c.h) {
    const a = c.w / c.h;
    const d = Math.abs(a - spec.aspect) / spec.aspect;
    s += 0.1 * Math.max(0, 1 - d);
  }

  if (spec.minWidth && c.w && c.w < spec.minWidth) s -= 0.15;

  s += 0.12 * (PROVIDER_RANK[c.provider] ?? 0.5);
  return s;
}

/** Score + sort candidates in place-safe fashion (returns a new sorted array). */
export function rankCandidates(cands: AssetCandidate[], spec: AssetSpec): AssetCandidate[] {
  const scored = cands.map((c) => ({ ...c, score: scoreCandidate(c, spec) }));
  scored.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
  return scored;
}

/**
 * Pick-the-right-pack: from a ranked list of iconify candidates, lock onto ONE
 * prefix (icon family) so a whole design uses a consistent set. The winning
 * prefix is the one whose members carry the most ranking weight, nudged by how
 * well the prefix's known style matches the requested style/weight.
 */
export function pickIconPack(
  ranked: AssetCandidate[],
  spec: AssetSpec,
): { prefix?: string; candidates: AssetCandidate[] } {
  const icons = ranked.filter((c) => c.provider === "iconify" && c.kind === "icon");
  if (icons.length === 0) return { candidates: ranked };

  const wantStyle = new Set((spec.style ?? []) as string[]);
  const packWeight = new Map<string, number>();
  for (const c of icons) {
    const prefix = c.id.includes(":") ? c.id.slice(0, c.id.indexOf(":")) : c.provider;
    let w = (c.score ?? 0) + 0.15; // per-member presence bonus
    const styles = PREFIX_STYLE[prefix];
    if (styles && wantStyle.size > 0) {
      const affinity = styles.filter((st) => wantStyle.has(st)).length;
      w += 0.25 * affinity;
    }
    packWeight.set(prefix, (packWeight.get(prefix) ?? 0) + w);
  }

  let best: string | undefined;
  let bestW = -Infinity;
  for (const [prefix, w] of packWeight) {
    if (w > bestW) {
      bestW = w;
      best = prefix;
    }
  }
  if (!best) return { candidates: ranked };

  const locked = icons.filter(
    (c) => (c.id.includes(":") ? c.id.slice(0, c.id.indexOf(":")) : c.provider) === best,
  );
  return { prefix: best, candidates: locked };
}

// ============================================================================
// Built-in providers (keyless-first)
// ============================================================================

function keyPresent(ctx: AssetSearchContext, key?: string): boolean {
  return !!key && typeof ctx.env[key] === "string" && ctx.env[key]!.length > 0;
}

/** Style tags implied by an iconify prefix, for candidate hints. */
function stylesForPrefix(prefix: string): StyleTag[] | undefined {
  return PREFIX_STYLE[prefix];
}

/** Iconify — keyless, 200k+ icons, unified search + per-icon SVG. */
const iconifyProvider: AssetProvider = {
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

const DICEBEAR_STYLES = [
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
const dicebearProvider: AssetProvider = {
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
const picsumProvider: AssetProvider = {
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
const unsplashProvider: AssetProvider = {
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
const pexelsProvider: AssetProvider = {
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
const pixabayProvider: AssetProvider = {
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

const BUILTIN_PROVIDERS: AssetProvider[] = [
  iconifyProvider,
  dicebearProvider,
  unsplashProvider,
  pexelsProvider,
  pixabayProvider,
  picsumProvider,
];

const registry = new Map<string, AssetProvider>(
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
function ensureBundledProviders(): Promise<void> {
  if (!_bundledReady) {
    _bundledReady = import("./providers/register")
      .then((m) => m.registerBundledAssetProviders())
      .catch(() => {
        /* extra providers optional; keep search working with the built-ins */
      });
  }
  return _bundledReady;
}

function isAvailable(p: AssetProvider, ctx: AssetSearchContext): boolean {
  if (p.available) return p.available(ctx);
  return p.keyless || keyPresent(ctx, p.envKey);
}

// ============================================================================
// Search + resolve
// ============================================================================

function makeCtx(opts: SearchOptions = {}): AssetSearchContext {
  return {
    env: opts.env ?? process.env,
    timeoutMs: opts.timeoutMs ?? DEFAULTS.timeoutMs,
    perProvider: opts.perProvider ?? DEFAULTS.perProvider,
  };
}

/**
 * Query every eligible provider in parallel, rank the union, and (for icons)
 * lock a single pack. Never throws — a provider that errors is dropped with a
 * reason.
 */
export async function searchAssets(
  spec: AssetSpec,
  opts: SearchOptions = {},
): Promise<SearchResult> {
  await ensureBundledProviders();
  const ctx = makeCtx(opts);
  const limit = opts.limit ?? DEFAULTS.limit;

  const providersRun: string[] = [];
  const providersDropped: { id: string; reason: string }[] = [];

  const eligible = listAssetProviders().filter((p) => {
    if (spec.provider && p.id !== spec.provider) {
      return false;
    }
    if (spec.kind && !p.kinds.includes(spec.kind)) {
      providersDropped.push({ id: p.id, reason: `does not serve kind "${spec.kind}"` });
      return false;
    }
    if (!isAvailable(p, ctx)) {
      providersDropped.push({
        id: p.id,
        reason: p.envKey ? `missing env ${p.envKey}` : "unavailable",
      });
      return false;
    }
    return true;
  });

  const settled = await Promise.allSettled(
    eligible.map(async (p) => ({ id: p.id, hits: await p.search(spec, ctx) })),
  );

  let all: AssetCandidate[] = [];
  settled.forEach((r, i) => {
    const p = eligible[i]!;
    if (r.status === "fulfilled") {
      providersRun.push(p.id);
      all = all.concat(r.value.hits);
    } else {
      providersDropped.push({
        id: p.id,
        reason: r.reason instanceof Error ? r.reason.message : String(r.reason),
      });
    }
  });

  // Lorem Picsum returns a RANDOM photo (its seed is for cache-stability, not
  // relevance). If any real, query-aware photo provider returned a hit, drop
  // Picsum entirely so random imagery is a true last resort, never a ranked peer.
  const hasRealPhoto = all.some((c) => c.kind === "photo" && c.provider !== "picsum");
  if (hasRealPhoto) all = all.filter((c) => c.provider !== "picsum");

  let ranked = rankCandidates(all, spec);

  let iconPack: string | undefined;
  const wantsIcons = spec.kind === "icon" || ranked.some((c) => c.kind === "icon");
  if (wantsIcons) {
    const nonIcons = ranked.filter((c) => c.kind !== "icon");
    const pack = pickIconPack(ranked, spec);
    iconPack = pack.prefix;
    // Locked-pack icons first (already ranked), then any non-icon hits.
    ranked = [...pack.candidates, ...nonIcons];
  }

  return {
    candidates: ranked.slice(0, limit),
    providersRun,
    providersDropped,
    iconPack,
  };
}

const PLACEHOLDER_QUERIES: Partial<Record<AssetKind, AssetSpec>> = {
  icon: { query: "image", kind: "icon" },
  photo: { query: "abstract", kind: "photo" },
  avatar: { query: "user", kind: "avatar" },
  illustration: { query: "abstract", kind: "illustration" },
};

/**
 * Resolve a spec end-to-end: search → rank → fetch the best candidate's bytes →
 * {@link SourcedAsset}. Tries successive candidates on fetch failure and finally
 * a deterministic placeholder, so this NEVER throws.
 */
export async function resolveAsset(
  spec: AssetSpec,
  opts: SearchOptions = {},
): Promise<SourcedAsset> {
  await ensureBundledProviders();
  const ctx = makeCtx(opts);

  const attempt = async (
    candidates: AssetCandidate[],
  ): Promise<SourcedAsset | null> => {
    for (const c of candidates) {
      try {
        const got = await c.fetch(ctx);
        const inlineSvg =
          got.ext === "svg" && got.svgText && got.svgText.length <= 8 * 1024
            ? got.svgText
            : undefined;
        return {
          kind: c.kind,
          w: c.w,
          h: c.h,
          url: c.url,
          scaleMode: c.scaleMode,
          inlineSvg,
          bytes: got.bytes,
          ext: got.ext,
          mime: got.mime,
          provider: c.provider,
          title: c.title,
          attribution: c.attribution,
          license: c.license,
        };
      } catch {
        // try the next candidate
      }
    }
    return null;
  };

  try {
    const { candidates } = await searchAssets(spec, { ...opts, limit: opts.limit ?? 8 });
    const hit = await attempt(candidates);
    if (hit) return hit;
  } catch {
    // fall through to placeholder
  }

  // Deterministic placeholder — pick a keyless provider for the (guessed) kind.
  const kind: AssetKind = spec.kind ?? "photo";
  const phSpec: AssetSpec = {
    ...(PLACEHOLDER_QUERIES[kind] ?? { query: spec.query || "placeholder", kind: "photo" }),
    seed: spec.seed ?? spec.query,
    palette: spec.palette,
    w: spec.w,
    h: spec.h,
    aspect: spec.aspect,
  };
  try {
    const { candidates } = await searchAssets(phSpec, { ...opts, limit: 4 });
    const hit = await attempt(candidates);
    if (hit) return { ...hit, placeholder: true };
  } catch {
    // give up quietly
  }

  return { kind, placeholder: true };
}

/**
 * Adapt this engine to the DSL compiler's {@link AssetResolver} contract. The
 * returned resolver strips the bytes (the compiler only needs the reference
 * shape); the write tool that actually stages bytes should call
 * {@link resolveAsset} directly and forward `bytes`/`ext` to `stageInboundAsset`.
 */
export function createAssetResolver(opts: SearchOptions = {}): AssetResolver {
  return {
    async resolve(spec: AssetSpec): Promise<ResolvedAsset> {
      const r = await resolveAsset(spec, opts);
      return {
        assetId: r.assetId,
        inlineSvg: r.inlineSvg,
        vectorPath: r.vectorPath,
        url: r.url,
        w: r.w,
        h: r.h,
        kind: r.kind,
        scaleMode: r.scaleMode,
      };
    },
  };
}
