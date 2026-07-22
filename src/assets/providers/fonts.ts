/**
 * Google Fonts. Two tiers:
 *  - Keyless (always available): a small curated manifest of popular
 *    families, filtered locally by query/category; bytes come back as the
 *    keyless `css2` stylesheet (`@font-face` rules + hosted `.woff2` URLs —
 *    no API key needed for that endpoint, only for the metadata/search API).
 *  - Keyed (`GOOGLE_FONTS_API_KEY` present): search hits the full catalog via
 *    `webfonts.googleapis.com`, falling back to the curated manifest if the
 *    request fails for any reason.
 * https://developers.google.com/fonts/docs/developer_api
 */

import type { AssetProvider, AssetProviderContext } from "./index";
import type { AssetCandidate, FetchedAsset } from "../types";
import { LICENSES } from "../types";
import { fetchJson, fetchText } from "../http";

const KIND = "font" as const;

interface FontsRaw {
  family: string;
  variants: string[];
}

interface CuratedFont {
  family: string;
  category: "serif" | "sans-serif" | "display" | "handwriting" | "monospace";
}

/** Keyless fallback — enough breadth to cover most brand type-scale needs
 *  (heading/body/mono) without ever calling out to the metadata API. */
const CURATED: CuratedFont[] = [
  { family: "Inter", category: "sans-serif" },
  { family: "Roboto", category: "sans-serif" },
  { family: "Open Sans", category: "sans-serif" },
  { family: "Lato", category: "sans-serif" },
  { family: "Montserrat", category: "sans-serif" },
  { family: "Poppins", category: "sans-serif" },
  { family: "Nunito", category: "sans-serif" },
  { family: "Raleway", category: "sans-serif" },
  { family: "Work Sans", category: "sans-serif" },
  { family: "Manrope", category: "sans-serif" },
  { family: "Space Grotesk", category: "sans-serif" },
  { family: "Sora", category: "sans-serif" },
  { family: "Outfit", category: "sans-serif" },
  { family: "Plus Jakarta Sans", category: "sans-serif" },
  { family: "DM Sans", category: "sans-serif" },
  { family: "Figtree", category: "sans-serif" },
  { family: "Karla", category: "sans-serif" },
  { family: "Rubik", category: "sans-serif" },
  { family: "Archivo", category: "sans-serif" },
  { family: "IBM Plex Sans", category: "sans-serif" },
  { family: "Merriweather", category: "serif" },
  { family: "Playfair Display", category: "serif" },
  { family: "Lora", category: "serif" },
  { family: "PT Serif", category: "serif" },
  { family: "Noto Serif", category: "serif" },
  { family: "Roboto Slab", category: "serif" },
  { family: "Bitter", category: "serif" },
  { family: "Libre Baskerville", category: "serif" },
  { family: "DM Serif Display", category: "serif" },
  { family: "Fraunces", category: "serif" },
  { family: "IBM Plex Serif", category: "serif" },
  { family: "Bebas Neue", category: "display" },
  { family: "Oswald", category: "display" },
  { family: "Anton", category: "display" },
  { family: "Josefin Sans", category: "display" },
  { family: "Quicksand", category: "display" },
  { family: "Comfortaa", category: "display" },
  { family: "Caveat", category: "handwriting" },
  { family: "Pacifico", category: "handwriting" },
  { family: "JetBrains Mono", category: "monospace" },
  { family: "Fira Code", category: "monospace" },
  { family: "Source Code Pro", category: "monospace" },
  { family: "IBM Plex Mono", category: "monospace" },
];

const DEFAULT_VARIANTS = ["400", "500", "600", "700"];

interface WebfontsItem {
  family: string;
  category?: string;
  variants?: string[];
  subsets?: string[];
}
interface WebfontsResponse {
  items?: WebfontsItem[];
}

function css2Url(family: string, variants: string[]): string {
  const axis = variants.join(";");
  return `https://fonts.googleapis.com/css2?family=${encodeURIComponent(family).replace(/%20/g, "+")}:wght@${axis}&display=swap`;
}

function matchesQuery(family: string, category: string | undefined, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return family.toLowerCase().includes(q) || (category ?? "").toLowerCase().includes(q);
}

export function createFontsProvider(apiKey?: string): AssetProvider {
  return {
    id: "google-fonts",
    kinds: [KIND],
    license: LICENSES.googleFonts,
    keyless: true,

    async search(spec, ctx: AssetProviderContext): Promise<AssetCandidate[]> {
      if (apiKey) {
        try {
          const params = new URLSearchParams({ key: apiKey, sort: "popularity" });
          const data = await fetchJson<WebfontsResponse>(
            `https://www.googleapis.com/webfonts/v1/webfonts?${params.toString()}`,
            ctx,
          );
          const hits = (data.items ?? []).filter((f) => matchesQuery(f.family, f.category, spec.query));
          if (hits.length) {
            return hits.slice(0, 30).map((f, i): AssetCandidate => {
              const raw: FontsRaw = { family: f.family, variants: DEFAULT_VARIANTS };
              return {
                id: f.family,
                provider: "google-fonts",
                kind: KIND,
                title: f.family,
                tags: [f.category ?? "sans-serif"],
                sourceUrl: `https://fonts.google.com/specimen/${encodeURIComponent(f.family).replace(/%20/g, "+")}`,
                license: LICENSES.googleFonts,
                score: hits.length - i,
                raw,
              };
            });
          }
        } catch {
          // fall through to the curated list below
        }
      }

      const hits = CURATED.filter((f) => matchesQuery(f.family, f.category, spec.query));
      const pool = hits.length ? hits : CURATED;
      return pool.slice(0, 12).map((f, i): AssetCandidate => {
        const raw: FontsRaw = { family: f.family, variants: DEFAULT_VARIANTS };
        return {
          id: f.family,
          provider: "google-fonts",
          kind: KIND,
          title: f.family,
          tags: [f.category],
          sourceUrl: `https://fonts.google.com/specimen/${encodeURIComponent(f.family).replace(/%20/g, "+")}`,
          license: LICENSES.googleFonts,
          score: pool.length - i,
          raw,
        };
      });
    },

    async fetch(candidate, ctx): Promise<FetchedAsset> {
      const raw = candidate.raw as FontsRaw | undefined;
      const family = raw?.family ?? candidate.id;
      const variants = raw?.variants ?? DEFAULT_VARIANTS;
      const url = css2Url(family, variants);
      // Keyless — the css2 endpoint needs a browser-like UA to serve woff2
      // (vs. legacy woff/eot for old UAs). Routed through http.ts's
      // fetchText so this gets the same timeout/abort handling as every
      // other provider — a hung fonts.googleapis.com must not stall
      // `apply-design` indefinitely.
      let css = "";
      try {
        css = await fetchText(url, ctx, { headers: { "User-Agent": "Mozilla/5.0" } });
      } catch {
        css = "";
      }
      return {
        bytes: new TextEncoder().encode(css),
        mime: "text/css",
        ext: "css",
        kind: KIND,
        license: candidate.license,
        sourceUrl: url,
      };
    },
  };
}
