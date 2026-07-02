/**
 * Hero-Patterns-style tileable SVG background patterns — keyless, bundled.
 * Freshly generated (procedural, not traced from heropatterns.com's actual
 * artwork) minimal geometric tiles in that same "subtle repeating SVG
 * background" genre: dots, grid, diagonal lines, checks, waves, zigzag,
 * cross, circuit. `%FG%`/`%BG%` swap for `AssetSpec.palette[0..1]`
 * (`AssetSpec.opacity`-style subtlety is left to the caller via the paint's
 * own opacity — these tiles render at full alpha so recoloring stays
 * predictable).
 */

import type { AssetProvider } from "./index";
import type { AssetCandidate, FetchedAsset } from "../types";
import { LICENSES } from "../types";

const KIND = "pattern" as const;
const DEFAULT_FG = "#000000";
const DEFAULT_BG_ALPHA = "0.06";

interface PatternRaw {
  slug: string;
  fg: string;
}

interface PatternDef {
  slug: string;
  title: string;
  tags: string[];
  tile: number;
  /** Pattern body only (no outer <svg>); %FG% placeholder for the ink color,
   *  drawn at `DEFAULT_BG_ALPHA` opacity by default (subtle background use). */
  body: string;
}

const PATTERNS: PatternDef[] = [
  {
    slug: "dots",
    title: "Polka dots",
    tags: ["dots", "polka", "spots"],
    tile: 20,
    body: `<circle cx="10" cy="10" r="2.5" fill="%FG%"/>`,
  },
  {
    slug: "grid",
    title: "Grid",
    tags: ["grid", "lines", "graph"],
    tile: 24,
    body: `<path d="M24 0H0V24" fill="none" stroke="%FG%" stroke-width="1"/>`,
  },
  {
    slug: "diagonal-lines",
    title: "Diagonal lines",
    tags: ["diagonal", "lines", "stripes"],
    tile: 16,
    body: `<path d="M-4 4l8-8M0 16l16-16M12 20l8-8" stroke="%FG%" stroke-width="2"/>`,
  },
  {
    slug: "checks",
    title: "Checkerboard",
    tags: ["checks", "checkerboard", "squares"],
    tile: 20,
    body: `<rect width="10" height="10" fill="%FG%"/><rect x="10" y="10" width="10" height="10" fill="%FG%"/>`,
  },
  {
    slug: "waves",
    title: "Waves",
    tags: ["waves", "curves", "water"],
    tile: 40,
    body: `<path d="M0 20c10-10 30-10 40 0" fill="none" stroke="%FG%" stroke-width="2"/>`,
  },
  {
    slug: "zigzag",
    title: "Zigzag",
    tags: ["zigzag", "chevron", "triangles"],
    tile: 20,
    body: `<path d="M0 10l10-10 10 10-10 10z" fill="none" stroke="%FG%" stroke-width="2"/>`,
  },
  {
    slug: "cross",
    title: "Plus / cross",
    tags: ["cross", "plus", "grid"],
    tile: 24,
    body: `<path d="M12 6v12M6 12h12" stroke="%FG%" stroke-width="2"/>`,
  },
  {
    slug: "circuit",
    title: "Circuit board",
    tags: ["circuit", "tech", "circuit-board"],
    tile: 40,
    body:
      `<path d="M0 20h12M28 20h12M20 0v12M20 28v40" stroke="%FG%" stroke-width="2" fill="none"/>` +
      `<circle cx="20" cy="20" r="3" fill="%FG%"/>`,
  },
];

function tileToSvg(p: PatternDef, fg: string): string {
  const body = p.body.replaceAll("%FG%", fg);
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${p.tile}" height="${p.tile}" ` +
    `viewBox="0 0 ${p.tile} ${p.tile}">` +
    `<g opacity="${DEFAULT_BG_ALPHA}">${body}</g>` +
    `</svg>`
  );
}

export function createPatternsProvider(): AssetProvider {
  return {
    id: "patterns",
    kinds: [KIND],
    license: LICENSES.bundled,
    keyless: true,

    async search(spec): Promise<AssetCandidate[]> {
      const q = spec.query.trim().toLowerCase();
      const fg = spec.palette?.[0] ?? DEFAULT_FG;
      const hits = q
        ? PATTERNS.filter((p) => p.slug.includes(q) || p.tags.some((t) => t.includes(q) || q.includes(t)))
        : PATTERNS;
      const pool = hits.length ? hits : PATTERNS;
      return pool.map((p, i): AssetCandidate => {
        const raw: PatternRaw = { slug: p.slug, fg };
        return {
          id: p.slug,
          provider: "patterns",
          kind: KIND,
          title: p.title,
          tags: p.tags,
          width: p.tile,
          height: p.tile,
          license: LICENSES.bundled,
          score: pool.length - i,
          raw,
        };
      });
    },

    async fetch(candidate): Promise<FetchedAsset> {
      const raw = candidate.raw as PatternRaw | undefined;
      const pattern = PATTERNS.find((p) => p.slug === (raw?.slug ?? candidate.id));
      if (!pattern) throw new Error(`patterns: unknown pattern "${candidate.id}"`);
      const svg = tileToSvg(pattern, raw?.fg ?? DEFAULT_FG);
      return {
        svg,
        mime: "image/svg+xml",
        ext: "svg",
        width: pattern.tile,
        height: pattern.tile,
        kind: KIND,
        license: candidate.license,
      };
    },
  };
}
