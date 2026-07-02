/**
 * Unsplash — high-quality stock photography search.
 * Requires `UNSPLASH_ACCESS_KEY`; dropped from the registry entirely when
 * absent (see `providers/index.ts`), so this file never runs keyless.
 * https://unsplash.com/documentation#search-photos
 */

import type { AssetProvider, AssetProviderContext } from "./index";
import type { AssetCandidate, FetchedAsset } from "../types";
import { LICENSES } from "../types";
import { fetchBytes, fetchJson } from "../http";

interface UnsplashPhoto {
  id: string;
  width: number;
  height: number;
  description?: string | null;
  alt_description?: string | null;
  urls: { raw: string; full: string; regular: string; small: string; thumb: string };
  links: { html: string };
  user: { name: string; links: { html: string } };
}

interface UnsplashSearchResponse {
  results?: UnsplashPhoto[];
  total?: number;
}

interface UnsplashRaw {
  downloadUrl: string;
}

const KIND = "photo" as const;

export function createUnsplashProvider(apiKey: string): AssetProvider {
  return {
    id: "unsplash",
    kinds: [KIND],
    license: LICENSES.unsplash,
    keyless: false,

    async search(spec, ctx: AssetProviderContext): Promise<AssetCandidate[]> {
      const params = new URLSearchParams({
        query: spec.query,
        per_page: "20",
        orientation: spec.aspect && spec.aspect > 1.15 ? "landscape" : spec.aspect && spec.aspect < 0.85 ? "portrait" : "squarish",
      });
      let data: UnsplashSearchResponse;
      try {
        data = await fetchJson<UnsplashSearchResponse>(
          `https://api.unsplash.com/search/photos?${params.toString()}`,
          ctx,
          { headers: { Authorization: `Client-ID ${apiKey}` } },
        );
      } catch {
        return [];
      }
      return (data.results ?? []).map((p, i): AssetCandidate => {
        const raw: UnsplashRaw = { downloadUrl: p.urls.regular };
        return {
          id: p.id,
          provider: "unsplash",
          kind: KIND,
          title: p.description ?? p.alt_description ?? undefined,
          width: p.width,
          height: p.height,
          previewUrl: p.urls.thumb,
          sourceUrl: p.links.html,
          author: p.user.name,
          authorUrl: p.user.links.html,
          license: LICENSES.unsplash,
          score: (data.results?.length ?? 0) - i,
          raw,
        };
      });
    },

    async fetch(candidate, ctx): Promise<FetchedAsset> {
      const raw = candidate.raw as UnsplashRaw | undefined;
      if (!raw) throw new Error(`unsplash: candidate "${candidate.id}" is missing its provider payload`);
      const { bytes, contentType } = await fetchBytes(raw.downloadUrl, ctx);
      return {
        bytes,
        mime: contentType || "image/jpeg",
        ext: "jpg",
        width: candidate.width,
        height: candidate.height,
        kind: KIND,
        license: candidate.license,
        sourceUrl: candidate.sourceUrl,
        attribution: candidate.author
          ? LICENSES.unsplash.attributionTemplate?.replace("{author}", candidate.author)
          : undefined,
      };
    },
  };
}
