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

import type { AssetKind, AssetResolver, AssetSpec, ResolvedAsset } from "../dsl/schema";
import type { AssetCandidate, AssetSearchContext, SearchOptions, SearchResult, SourcedAsset } from "./search/contracts";
import { DEFAULTS } from "./search/contracts";
import { ensureBundledProviders, isAvailable, listAssetProviders } from "./search/builtins";
import { pickIconPack, rankCandidates } from "./search/rank";

export type {
  AssetCandidate,
  AssetExt,
  AssetProvider,
  AssetSearchContext,
  FetchedBytes,
  SearchOptions,
  SearchResult,
  SourcedAsset,
} from "./search/contracts";
export { listAssetProviders, registerAssetProvider } from "./search/builtins";
export { pickIconPack, rankCandidates, scoreCandidate } from "./search/rank";

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
