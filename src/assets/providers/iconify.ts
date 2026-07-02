/**
 * Iconify — keyless, unified search across 200k+ icons from ~150 open icon
 * sets (Material Design Icons, Phosphor, Lucide, Tabler, Heroicons, …).
 * https://iconify.design/docs/api/
 */

import type { AssetProvider, AssetProviderContext } from "./index";
import type { AssetCandidate, FetchedAsset } from "../types";
import { LICENSES } from "../types";
import { fetchJson, fetchText } from "../http";

interface IconifySearchResponse {
  icons?: string[]; // "prefix:name"
  total?: number;
  collections?: Record<string, { name?: string; license?: { title?: string; url?: string } }>;
}

interface IconifyRaw {
  prefix: string;
  name: string;
}

const KIND = "icon" as const;

export function createIconifyProvider(): AssetProvider {
  return {
    id: "iconify",
    kinds: [KIND],
    license: LICENSES.iconify,
    keyless: true,

    async search(spec, ctx: AssetProviderContext): Promise<AssetCandidate[]> {
      const params = new URLSearchParams({ query: spec.query, limit: "48" });
      let data: IconifySearchResponse;
      try {
        data = await fetchJson<IconifySearchResponse>(
          `https://api.iconify.design/search?${params.toString()}`,
          ctx,
        );
      } catch {
        return [];
      }
      const icons = data.icons ?? [];
      return icons
        .map((full, i): AssetCandidate | undefined => {
          const [prefix, name] = full.split(":");
          if (!prefix || !name) return undefined;
          const collection = data.collections?.[prefix];
          const license = collection?.license?.title
            ? {
                id: `iconify:${prefix}`,
                name: collection.license.title,
                url: collection.license.url,
                requiresAttribution: false,
                commercial: true,
              }
            : LICENSES.iconify;
          const raw: IconifyRaw = { prefix, name };
          return {
            id: full,
            provider: "iconify",
            kind: KIND,
            title: name.replace(/-/g, " "),
            tags: [prefix, name, ...(collection?.name ? [collection.name] : [])],
            sourceUrl: `https://icon-sets.iconify.design/${prefix}/${name}/`,
            license,
            score: icons.length - i,
            raw,
          };
        })
        .filter((c): c is AssetCandidate => c !== undefined);
    },

    async fetch(candidate, ctx): Promise<FetchedAsset> {
      const raw = candidate.raw as IconifyRaw | undefined;
      if (!raw) throw new Error(`iconify: candidate "${candidate.id}" is missing its provider payload`);
      const url = `https://api.iconify.design/${raw.prefix}/${raw.name}.svg`;
      const svg = await fetchText(url, ctx);
      const path = svg.match(/\sd="([^"]+)"/)?.[1];
      return {
        svg,
        vectorPath: path,
        mime: "image/svg+xml",
        ext: "svg",
        kind: KIND,
        license: candidate.license,
        sourceUrl: candidate.sourceUrl,
      };
    },
  };
}
