/**
 * Pexels — stock photography search.
 * Requires `PEXELS_API_KEY`; dropped from the registry entirely when absent.
 * https://www.pexels.com/api/documentation/#photos-search
 */

import type { AssetProvider, AssetProviderContext } from "./index";
import type { AssetCandidate, FetchedAsset } from "../types";
import { LICENSES } from "../types";
import { fetchBytes, fetchJson } from "../http";

interface PexelsPhoto {
  id: number;
  width: number;
  height: number;
  url: string;
  photographer: string;
  photographer_url: string;
  alt?: string;
  src: { original: string; large2x: string; large: string; medium: string; small: string; tiny: string };
}

interface PexelsSearchResponse {
  photos?: PexelsPhoto[];
  total_results?: number;
}

interface PexelsRaw {
  downloadUrl: string;
}

const KIND = "photo" as const;

export function createPexelsProvider(apiKey: string): AssetProvider {
  return {
    id: "pexels",
    kinds: [KIND],
    license: LICENSES.pexels,
    keyless: false,

    async search(spec, ctx: AssetProviderContext): Promise<AssetCandidate[]> {
      const params = new URLSearchParams({ query: spec.query, per_page: "20" });
      if (spec.aspect && spec.aspect > 1.15) params.set("orientation", "landscape");
      else if (spec.aspect && spec.aspect < 0.85) params.set("orientation", "portrait");
      let data: PexelsSearchResponse;
      try {
        data = await fetchJson<PexelsSearchResponse>(
          `https://api.pexels.com/v1/search?${params.toString()}`,
          ctx,
          { headers: { Authorization: apiKey } },
        );
      } catch {
        return [];
      }
      return (data.photos ?? []).map((p, i): AssetCandidate => {
        const raw: PexelsRaw = { downloadUrl: p.src.large2x };
        return {
          id: String(p.id),
          provider: "pexels",
          kind: KIND,
          title: p.alt,
          width: p.width,
          height: p.height,
          previewUrl: p.src.tiny,
          sourceUrl: p.url,
          author: p.photographer,
          authorUrl: p.photographer_url,
          license: LICENSES.pexels,
          score: (data.photos?.length ?? 0) - i,
          raw,
        };
      });
    },

    async fetch(candidate, ctx): Promise<FetchedAsset> {
      const raw = candidate.raw as PexelsRaw | undefined;
      if (!raw) throw new Error(`pexels: candidate "${candidate.id}" is missing its provider payload`);
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
          ? LICENSES.pexels.attributionTemplate?.replace("{author}", candidate.author)
          : undefined,
      };
    },
  };
}
