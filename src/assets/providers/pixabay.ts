/**
 * Pixabay — stock photography (+ illustrations/vectors) search.
 * Requires `PIXABAY_API_KEY`; dropped from the registry entirely when absent.
 * https://pixabay.com/api/docs/
 */

import type { AssetProvider, AssetProviderContext } from "./index";
import type { AssetCandidate, FetchedAsset } from "../types";
import { LICENSES } from "../types";
import { fetchBytes, fetchJson } from "../http";

interface PixabayHit {
  id: number;
  pageURL: string;
  tags: string;
  user: string;
  imageWidth: number;
  imageHeight: number;
  previewURL: string;
  largeImageURL: string;
}

interface PixabaySearchResponse {
  hits?: PixabayHit[];
  totalHits?: number;
}

interface PixabayRaw {
  downloadUrl: string;
}

const KIND = "photo" as const;

export function createPixabayProvider(apiKey: string): AssetProvider {
  return {
    id: "pixabay",
    kinds: [KIND],
    license: LICENSES.pixabay,
    keyless: false,

    async search(spec, ctx: AssetProviderContext): Promise<AssetCandidate[]> {
      const params = new URLSearchParams({
        key: apiKey,
        q: spec.query,
        image_type: "photo",
        per_page: "20",
        safesearch: "true",
      });
      if (spec.aspect && spec.aspect > 1.15) params.set("orientation", "horizontal");
      else if (spec.aspect && spec.aspect < 0.85) params.set("orientation", "vertical");
      let data: PixabaySearchResponse;
      try {
        data = await fetchJson<PixabaySearchResponse>(`https://pixabay.com/api/?${params.toString()}`, ctx);
      } catch {
        return [];
      }
      return (data.hits ?? []).map((h, i): AssetCandidate => {
        const raw: PixabayRaw = { downloadUrl: h.largeImageURL };
        return {
          id: String(h.id),
          provider: "pixabay",
          kind: KIND,
          title: h.tags,
          tags: h.tags.split(",").map((t) => t.trim()),
          width: h.imageWidth,
          height: h.imageHeight,
          previewUrl: h.previewURL,
          sourceUrl: h.pageURL,
          author: h.user,
          license: LICENSES.pixabay,
          score: (data.hits?.length ?? 0) - i,
          raw,
        };
      });
    },

    async fetch(candidate, ctx): Promise<FetchedAsset> {
      const raw = candidate.raw as PixabayRaw | undefined;
      if (!raw) throw new Error(`pixabay: candidate "${candidate.id}" is missing its provider payload`);
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
          ? LICENSES.pixabay.attributionTemplate?.replace("{author}", candidate.author)
          : undefined,
      };
    },
  };
}
