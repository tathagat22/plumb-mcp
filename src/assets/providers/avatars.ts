/**
 * DiceBear — keyless, deterministic generated avatars. `AssetSpec.seed`
 * (falling back to `query`) picks the identity; same seed always renders the
 * same avatar, which is what makes it useful for placeholder user lists.
 * https://www.dicebear.com/how-to-use/http-api/
 */

import type { AssetProvider, AssetProviderContext } from "./index";
import type { AssetCandidate, FetchedAsset } from "../types";
import { LICENSES } from "../types";
import { fetchText } from "../http";

const KIND = "avatar" as const;
const DICEBEAR_VERSION = "9.x";

/** A handful of DiceBear styles spanning the common "avatar" aesthetics;
 *  `AssetSpec.style` tags steer which ones get offered. */
const STYLES: Array<{ id: string; tags: string[] }> = [
  { id: "avataaars", tags: ["illustration", "flat", "cartoon"] },
  { id: "lorelei", tags: ["illustration", "flat"] },
  { id: "adventurer", tags: ["illustration", "flat"] },
  { id: "notionists", tags: ["line", "flat"] },
  { id: "pixel-art", tags: ["geometric", "pixel"] },
  { id: "identicon", tags: ["geometric", "abstract"] },
  { id: "initials", tags: ["geometric", "text"] },
  { id: "bottts", tags: ["3d", "cartoon"] },
];

interface DicebearRaw {
  style: string;
  seed: string;
}

function pickStyles(spec: { style?: string[] }): typeof STYLES {
  if (!spec.style?.length) return STYLES;
  const wanted = new Set(spec.style);
  const matched = STYLES.filter((s) => s.tags.some((t) => wanted.has(t)));
  return matched.length ? matched : STYLES;
}

export function createAvatarsProvider(): AssetProvider {
  return {
    id: "dicebear",
    kinds: [KIND],
    license: LICENSES.dicebear,
    keyless: true,

    async search(spec): Promise<AssetCandidate[]> {
      const seed = spec.seed || spec.query || "plumb";
      const styles = pickStyles(spec);
      return styles.map((s, i): AssetCandidate => {
        const raw: DicebearRaw = { style: s.id, seed };
        return {
          id: `${s.id}:${seed}`,
          provider: "dicebear",
          kind: KIND,
          title: s.id,
          tags: s.tags,
          previewUrl: `https://api.dicebear.com/${DICEBEAR_VERSION}/${s.id}/svg?seed=${encodeURIComponent(seed)}&size=64`,
          sourceUrl: `https://api.dicebear.com/${DICEBEAR_VERSION}/${s.id}/svg?seed=${encodeURIComponent(seed)}`,
          license: LICENSES.dicebear,
          score: styles.length - i,
          raw,
        };
      });
    },

    async fetch(candidate, ctx: AssetProviderContext): Promise<FetchedAsset> {
      const raw = candidate.raw as DicebearRaw | undefined;
      if (!raw) throw new Error(`dicebear: candidate "${candidate.id}" is missing its provider payload`);
      const url = `https://api.dicebear.com/${DICEBEAR_VERSION}/${raw.style}/svg?seed=${encodeURIComponent(raw.seed)}`;
      const svg = await fetchText(url, ctx);
      return {
        svg,
        mime: "image/svg+xml",
        ext: "svg",
        kind: KIND,
        license: candidate.license,
        sourceUrl: url,
      };
    },
  };
}
