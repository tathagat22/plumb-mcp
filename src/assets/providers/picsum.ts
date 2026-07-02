/**
 * Lorem Picsum — keyless placeholder photography. No real search endpoint
 * (Picsum serves random/seeded photos, not a query index), so `search()`
 * synthesizes a handful of deterministic candidates from the query text as a
 * seed — same query always returns the same set, and different queries
 * still return different-looking photos. This is the photo-kind fallback
 * that's ALWAYS available, so `kind: "photo"` never comes back empty even
 * with zero API keys configured.
 * https://picsum.photos/
 */

import type { AssetProvider, AssetProviderContext } from "./index";
import type { AssetCandidate, FetchedAsset } from "../types";
import { LICENSES } from "../types";
import { fetchBytes } from "../http";

const KIND = "photo" as const;
const VARIANTS = 4;

interface PicsumRaw {
  seed: string;
  w: number;
  h: number;
}

/** Small stable string hash — good enough for seed diversity, not security. */
function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

export function createPicsumProvider(): AssetProvider {
  return {
    id: "picsum",
    kinds: [KIND],
    license: LICENSES.picsum,
    keyless: true,

    async search(spec): Promise<AssetCandidate[]> {
      const w = spec.w ?? 800;
      const h = spec.h ?? (spec.aspect ? Math.round(w / spec.aspect) : 600);
      const base = hash(spec.query || "plumb");
      const candidates: AssetCandidate[] = [];
      for (let i = 0; i < VARIANTS; i++) {
        const seed = `${spec.query || "plumb"}-${base + i}`;
        const raw: PicsumRaw = { seed, w, h };
        candidates.push({
          id: seed,
          provider: "picsum",
          kind: KIND,
          width: w,
          height: h,
          previewUrl: `https://picsum.photos/seed/${encodeURIComponent(seed)}/200/${Math.round((200 * h) / w)}`,
          sourceUrl: `https://picsum.photos/seed/${encodeURIComponent(seed)}/${w}/${h}`,
          license: LICENSES.picsum,
          score: VARIANTS - i,
          raw,
        });
      }
      return candidates;
    },

    async fetch(candidate, ctx: AssetProviderContext): Promise<FetchedAsset> {
      const raw = candidate.raw as PicsumRaw | undefined;
      const seed = raw?.seed ?? candidate.id;
      const w = raw?.w ?? candidate.width ?? 800;
      const h = raw?.h ?? candidate.height ?? 600;
      const url = `https://picsum.photos/seed/${encodeURIComponent(seed)}/${w}/${h}`;
      const { bytes, contentType } = await fetchBytes(url, ctx);
      return {
        bytes,
        mime: contentType || "image/jpeg",
        ext: "jpg",
        width: w,
        height: h,
        kind: KIND,
        license: candidate.license,
        sourceUrl: url,
      };
    },
  };
}
