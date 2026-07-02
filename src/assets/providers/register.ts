/**
 * Bridges `providers/*.ts` (this task's `AssetProvider` shape — a two-step
 * `search()` + `fetch(candidate)`) into `src/assets/search.ts`'s
 * ALREADY-WIRED `AssetProvider`/registry/`resolveAsset`/`createAssetResolver`
 * pipeline, which is what `src/dsl/compile.ts`'s `CompileContext.assets`
 * actually consumes.
 *
 * Why this exists: `search.ts` independently ships its own keyless-first
 * providers for icon/photo/avatar (iconify, dicebear, unsplash, pexels,
 * pixabay, picsum) — those overlap this task's `iconify.ts` / `unsplash.ts`
 * / `pexels.ts` / `pixabay.ts` / `picsum.ts` / `avatars.ts` and are
 * deliberately left alone here (same ids would just overwrite an equivalent
 * provider). What `search.ts` does NOT cover at all is `illustration` /
 * `mockup` / `pattern` (and `font`, which doesn't fit its bytes model — see
 * below) — this file registers exactly those four so the kinds this task
 * added are reachable through the pipeline the compiler already calls.
 *
 * `font` is intentionally NOT bridged: `search.ts`'s `FetchedBytes.ext` is
 * `"png" | "jpg" | "webp" | "gif" | "svg"` and its whole model is "bytes of
 * an image", whereas `fonts.ts.fetch()` returns `@font-face` CSS text
 * (mime `text/css`) — plumbing that through would need `search.ts`'s own
 * shapes to grow a font case, which is out of this task's file-ownership
 * (see the followups in this task's report).
 *
 * Call `registerBundledAssetProviders()` once at startup (e.g. alongside
 * wherever `createAssetResolver()` gets constructed) before resolving any
 * `illustration`/`mockup`/`pattern` spec.
 */

import {
  registerAssetProvider,
  type AssetCandidate as SearchCandidate,
  type AssetProvider as SearchProvider,
  type AssetSearchContext,
  type FetchedBytes,
} from "../search";
import type { AssetProvider as BundledProvider, AssetProviderContext } from "./index";
import { createIllustrationsProvider } from "./illustrations";
import { createUndrawProvider } from "./undraw";
import { createMockupsProvider } from "./mockups";
import { createPatternsProvider } from "./patterns";

function toSearchContext(ctx: AssetSearchContext): AssetProviderContext {
  return { env: ctx.env, timeoutMs: ctx.timeoutMs };
}

/** Adapts one of this task's two-phase providers into `search.ts`'s
 *  candidate-carries-its-own-fetch-closure shape. All four bridged
 *  providers only ever emit inline SVG, so `ext`/`mime` are fixed. */
function adapt(provider: BundledProvider): SearchProvider {
  return {
    id: provider.id,
    kinds: provider.kinds,
    keyless: provider.keyless,
    async search(spec, ctx: AssetSearchContext): Promise<SearchCandidate[]> {
      let hits: Awaited<ReturnType<BundledProvider["search"]>>;
      try {
        hits = await provider.search(spec, toSearchContext(ctx));
      } catch {
        return [];
      }
      return hits.map((c): SearchCandidate => ({
        id: c.id,
        provider: provider.id,
        kind: c.kind,
        title: c.title,
        tags: c.tags,
        w: c.width,
        h: c.height,
        url: c.sourceUrl,
        thumbUrl: c.previewUrl,
        license: c.license.name,
        attribution: c.author,
        fetch: async (fetchCtx: AssetSearchContext): Promise<FetchedBytes> => {
          const fetched = await provider.fetch(c, toSearchContext(fetchCtx));
          const svgText = fetched.svg;
          const bytes = fetched.bytes ?? (svgText ? new TextEncoder().encode(svgText) : new Uint8Array());
          return { bytes, ext: "svg", mime: fetched.mime, svgText };
        },
      }));
    },
  };
}

/** Registers the illustration/mockup/pattern providers into `search.ts`'s
 *  global registry. Idempotent (re-registering an id just overwrites it with
 *  an identical provider), so safe to call more than once. */
export function registerBundledAssetProviders(): void {
  registerAssetProvider(adapt(createIllustrationsProvider()));
  registerAssetProvider(adapt(createUndrawProvider()));
  registerAssetProvider(adapt(createMockupsProvider()));
  registerAssetProvider(adapt(createPatternsProvider()));
}
