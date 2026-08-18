/**
 * The asset-search contracts: what a provider is, what a candidate looks like,
 * and the options/results that bracket a search.
 *
 * Separate from `src/assets/types.ts` on purpose — that file is the canonical
 * asset-engine vocabulary shared with the `providers/` directory, while these
 * are the shapes this particular search orchestrator passes around.
 */

import type { AssetKind, AssetSpec, IconWeight, ResolvedAsset, StyleTag } from "../../dsl/schema";

// ============================================================================
// Public types
// ============================================================================

export type AssetExt = "png" | "jpg" | "webp" | "gif" | "svg";

export const EXT_MIME: Record<AssetExt, string> = {
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

export const DEFAULTS = { limit: 16, timeoutMs: 10_000, perProvider: 24 } as const;
