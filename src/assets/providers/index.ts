/**
 * `AssetProvider` interface + the default provider registry (blueprint §8,
 * `provider.ts` + `registry.ts` collapsed into this one barrel per the
 * asset-providers build task).
 *
 * Every concrete provider in this directory is a small factory
 * (`createXProvider(...)`) returning an `AssetProvider`. Factories that need
 * an API key take it as an argument instead of reading `process.env`
 * themselves, so `registerDefaultProviders` is the ONE place that decides
 * whether a keyed provider is available — keeping "degrade gracefully when a
 * key is absent" a single, auditable rule instead of scattered env reads.
 */

import type { AssetSpec } from "../../dsl/schema";
import type { AssetCandidate, AssetKind, FetchedAsset, LicenseRef } from "../types";
import type { HttpCtx } from "../http";

import { createIconifyProvider } from "./iconify";
import { createUnsplashProvider } from "./unsplash";
import { createPexelsProvider } from "./pexels";
import { createPixabayProvider } from "./pixabay";
import { createPicsumProvider } from "./picsum";
import { createUndrawProvider } from "./undraw";
import { createIllustrationsProvider } from "./illustrations";
import { createMockupsProvider } from "./mockups";
import { createFontsProvider } from "./fonts";
import { createAvatarsProvider } from "./avatars";
import { createPatternsProvider } from "./patterns";

/** Per-call context passed to `search`/`fetch`. Extends the plain HTTP
 *  context with the process env, so a provider factory that DOES need to
 *  re-check env at call time (rare) still can without importing `process`
 *  directly. */
export interface AssetProviderContext extends HttpCtx {
  env: Record<string, string | undefined>;
}

/**
 * One asset source. `kinds` scopes which `AssetSpec.kind` values it should be
 * tried for; `keyless` tells the registry (and any UI) whether it works with
 * zero configuration. `search` MUST return `[]` (never throw) on any network
 * or parse failure — providers degrade per-call, not just at registration.
 */
export interface AssetProvider {
  readonly id: string;
  readonly kinds: AssetKind[];
  readonly license: LicenseRef;
  readonly keyless: boolean;
  search(spec: AssetSpec, ctx: AssetProviderContext): Promise<AssetCandidate[]>;
  fetch(candidate: AssetCandidate, ctx: AssetProviderContext): Promise<FetchedAsset>;
}

/** Builds the default provider set from environment variables. Keyed
 *  providers (Unsplash/Pexels/Pixabay) are simply omitted when their key is
 *  absent — callers never need to special-case a missing key, they just get
 *  fewer providers for `kind: "photo"` (Picsum always covers that gap). */
export function registerDefaultProviders(
  env: Record<string, string | undefined> = process.env,
): AssetProvider[] {
  const providers: AssetProvider[] = [
    createIconifyProvider(),
    createPicsumProvider(),
    createUndrawProvider(),
    createIllustrationsProvider(),
    createMockupsProvider(),
    createFontsProvider(env.GOOGLE_FONTS_API_KEY),
    createAvatarsProvider(),
    createPatternsProvider(),
  ];

  if (env.UNSPLASH_ACCESS_KEY) providers.push(createUnsplashProvider(env.UNSPLASH_ACCESS_KEY));
  if (env.PEXELS_API_KEY) providers.push(createPexelsProvider(env.PEXELS_API_KEY));
  if (env.PIXABAY_API_KEY) providers.push(createPixabayProvider(env.PIXABAY_API_KEY));

  return providers;
}

/** Thin lookup wrapper over a provider list — `search.ts`/`rank.ts` (a
 *  separate build task) is the intended consumer, but this is usable
 *  standalone too. */
export class AssetRegistry {
  private readonly providers: AssetProvider[];

  constructor(providers: AssetProvider[] = registerDefaultProviders()) {
    this.providers = providers;
  }

  all(): AssetProvider[] {
    return this.providers;
  }

  get(id: string): AssetProvider | undefined {
    return this.providers.find((p) => p.id === id);
  }

  forKind(kind: AssetKind): AssetProvider[] {
    return this.providers.filter((p) => p.kinds.includes(kind));
  }
}

export {
  createIconifyProvider,
  createUnsplashProvider,
  createPexelsProvider,
  createPixabayProvider,
  createPicsumProvider,
  createUndrawProvider,
  createIllustrationsProvider,
  createMockupsProvider,
  createFontsProvider,
  createAvatarsProvider,
  createPatternsProvider,
};
