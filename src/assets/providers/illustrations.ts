/**
 * Open Doodles / Humaaans-style CHARACTER illustrations — keyless, bundled.
 *
 * Same rationale as `undraw.ts`: the real Open Doodles/Humaaans sets are a
 * specific artist's free-to-use assets with no stable keyless API to pull
 * from programmatically, so this ships a freshly authored manifest of
 * simple flat human figures (standing/sitting/waving/presenting/…) in that
 * genre, keeping `kind: "illustration"` populated for people-centric asks
 * ("hero-person", "team-member", "testimonial-avatar-figure") without any
 * network dependency. `%SKIN%`/`%CLOTHES%`/`%BG%` swap for
 * `AssetSpec.palette[0..2]`.
 */

import type { AssetProvider } from "./index";
import type { AssetCandidate, FetchedAsset } from "../types";
import { LICENSES } from "../types";

const KIND = "illustration" as const;

interface CharacterRaw {
  slug: string;
  palette: [string, string, string];
}

const DEFAULT_PALETTE: [string, string, string] = ["#F2C9A0", "#2D3436", "#F1F2F6"];

interface Character {
  slug: string;
  title: string;
  tags: string[];
  /** 160x220 viewBox, %SKIN% / %CLOTHES% / %BG% placeholders. */
  svg: string;
}

const CHARACTERS: Character[] = [
  {
    slug: "standing",
    title: "Standing person",
    tags: ["person", "standing", "hero", "team", "profile"],
    svg:
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 220">` +
      `<rect width="160" height="220" fill="%BG%"/>` +
      `<circle cx="80" cy="52" r="26" fill="%SKIN%"/>` +
      `<path d="M50 210V128a30 30 0 0160-4v86z" fill="%CLOTHES%"/>` +
      `<rect x="42" y="118" width="16" height="60" rx="8" fill="%SKIN%"/>` +
      `<rect x="102" y="118" width="16" height="60" rx="8" fill="%SKIN%"/>` +
      `</svg>`,
  },
  {
    slug: "waving",
    title: "Waving / greeting",
    tags: ["person", "wave", "greeting", "hello", "welcome"],
    svg:
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 220">` +
      `<rect width="160" height="220" fill="%BG%"/>` +
      `<circle cx="76" cy="52" r="26" fill="%SKIN%"/>` +
      `<path d="M48 210V130a28 28 0 0156-3v83z" fill="%CLOTHES%"/>` +
      `<rect x="40" y="120" width="16" height="58" rx="8" fill="%SKIN%"/>` +
      `<path d="M108 118c14-6 26-24 22-40" fill="none" stroke="%SKIN%" stroke-width="16" stroke-linecap="round"/>` +
      `</svg>`,
  },
  {
    slug: "sitting",
    title: "Sitting person",
    tags: ["person", "sitting", "chair", "relaxed", "desk"],
    svg:
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 220">` +
      `<rect width="160" height="220" fill="%BG%"/>` +
      `<circle cx="80" cy="60" r="24" fill="%SKIN%"/>` +
      `<path d="M52 190v-50a28 28 0 0156 0v50z" fill="%CLOTHES%"/>` +
      `<rect x="52" y="185" width="56" height="16" rx="8" fill="%CLOTHES%"/>` +
      `<rect x="40" y="196" width="80" height="10" rx="5" fill="%SKIN%" opacity="0.4"/>` +
      `</svg>`,
  },
  {
    slug: "presenting",
    title: "Presenting / pointing",
    tags: ["person", "presenting", "pointing", "teaching", "product"],
    svg:
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 220">` +
      `<rect width="160" height="220" fill="%BG%"/>` +
      `<circle cx="70" cy="52" r="26" fill="%SKIN%"/>` +
      `<path d="M42 210V128a30 30 0 0158-6v88z" fill="%CLOTHES%"/>` +
      `<path d="M96 128c22-4 40 6 48 26" fill="none" stroke="%SKIN%" stroke-width="16" stroke-linecap="round"/>` +
      `<rect x="32" y="118" width="16" height="60" rx="8" fill="%SKIN%"/>` +
      `</svg>`,
  },
  {
    slug: "thinking",
    title: "Thinking / idea",
    tags: ["person", "thinking", "idea", "planning", "strategy"],
    svg:
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 220">` +
      `<rect width="160" height="220" fill="%BG%"/>` +
      `<circle cx="80" cy="54" r="26" fill="%SKIN%"/>` +
      `<circle cx="118" cy="24" r="6" fill="%CLOTHES%"/>` +
      `<circle cx="130" cy="10" r="4" fill="%CLOTHES%"/>` +
      `<path d="M52 210V128a28 28 0 0156 0v82z" fill="%CLOTHES%"/>` +
      `<rect x="98" y="70" width="14" height="46" rx="7" fill="%SKIN%" transform="rotate(20 105 93)"/>` +
      `</svg>`,
  },
  {
    slug: "celebrating",
    title: "Celebrating / success",
    tags: ["person", "celebrating", "success", "excited", "cheer"],
    svg:
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 220">` +
      `<rect width="160" height="220" fill="%BG%"/>` +
      `<circle cx="80" cy="54" r="26" fill="%SKIN%"/>` +
      `<path d="M52 210V132a28 28 0 0156 0v78z" fill="%CLOTHES%"/>` +
      `<path d="M52 128c-8-18-4-40 8-50" fill="none" stroke="%SKIN%" stroke-width="16" stroke-linecap="round"/>` +
      `<path d="M108 128c8-18 4-40-8-50" fill="none" stroke="%SKIN%" stroke-width="16" stroke-linecap="round"/>` +
      `</svg>`,
  },
];

function applyPalette(svg: string, palette: [string, string, string]): string {
  return svg
    .replaceAll("%SKIN%", palette[0])
    .replaceAll("%CLOTHES%", palette[1])
    .replaceAll("%BG%", palette[2]);
}

function resolvePalette(spec: { palette?: string[] }): [string, string, string] {
  const p = spec.palette;
  return [p?.[0] ?? DEFAULT_PALETTE[0], p?.[1] ?? DEFAULT_PALETTE[1], p?.[2] ?? DEFAULT_PALETTE[2]];
}

export function createIllustrationsProvider(): AssetProvider {
  return {
    id: "illustrations",
    kinds: [KIND],
    license: LICENSES.bundled,
    keyless: true,

    async search(spec): Promise<AssetCandidate[]> {
      const q = spec.query.trim().toLowerCase();
      const palette = resolvePalette(spec);
      const hits = q
        ? CHARACTERS.filter((c) => c.slug.includes(q) || c.tags.some((t) => t.includes(q) || q.includes(t)))
        : CHARACTERS;
      const pool = hits.length ? hits : CHARACTERS;
      return pool.map((c, i): AssetCandidate => {
        const raw: CharacterRaw = { slug: c.slug, palette };
        return {
          id: c.slug,
          provider: "illustrations",
          kind: KIND,
          title: c.title,
          tags: c.tags,
          license: LICENSES.bundled,
          score: pool.length - i,
          raw,
        };
      });
    },

    async fetch(candidate): Promise<FetchedAsset> {
      const raw = candidate.raw as CharacterRaw | undefined;
      const character = CHARACTERS.find((c) => c.slug === (raw?.slug ?? candidate.id));
      if (!character) throw new Error(`illustrations: unknown character "${candidate.id}"`);
      const svg = applyPalette(character.svg, raw?.palette ?? DEFAULT_PALETTE);
      return {
        svg,
        mime: "image/svg+xml",
        ext: "svg",
        width: 160,
        height: 220,
        kind: KIND,
        license: candidate.license,
      };
    },
  };
}
