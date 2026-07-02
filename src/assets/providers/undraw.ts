/**
 * "unDraw-style" flat scene illustrations — keyless, bundled.
 *
 * unDraw itself has no public search/fetch API (it's a static picker site),
 * and its SVGs are a specific artist's copyrighted-but-free-to-use work that
 * we can't legally re-host without pulling the exact files from a source we
 * can verify the license terms of. Per the blueprint's "MUST degrade
 * gracefully… never crash" rule, this provider ships a small, freshly
 * authored manifest of generic flat-illustration SCENES (empty states,
 * errors, onboarding, …) in the same visual genre as unDraw — two-tone flat
 * shapes with a single accent color — so `kind: "illustration"` always has
 * a keyless, license-clean fallback. `%ACCENT%`/`%DARK%`/`%BG%` in each
 * template are swapped for `AssetSpec.palette[0..2]` at fetch time (falling
 * back to a neutral indigo/slate/off-white triad) so results roughly match
 * brand colors without a separate recolor pass.
 */

import type { AssetProvider } from "./index";
import type { AssetCandidate, FetchedAsset } from "../types";
import { LICENSES } from "../types";

const KIND = "illustration" as const;

interface UndrawRaw {
  slug: string;
  palette: [string, string, string];
}

const DEFAULT_PALETTE: [string, string, string] = ["#6C5CE7", "#2D3436", "#F1F2F6"];

interface Scene {
  slug: string;
  title: string;
  tags: string[];
  /** 240x200 viewBox, uses %ACCENT% / %DARK% / %BG% placeholders. */
  svg: string;
}

const SCENES: Scene[] = [
  {
    slug: "empty-state",
    title: "Empty state",
    tags: ["empty", "empty-state", "search", "no-results"],
    svg:
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 200">` +
      `<rect width="240" height="200" fill="%BG%"/>` +
      `<circle cx="105" cy="95" r="48" fill="none" stroke="%ACCENT%" stroke-width="10"/>` +
      `<rect x="138" y="128" width="16" height="52" rx="8" transform="rotate(45 138 128)" fill="%DARK%"/>` +
      `<circle cx="105" cy="95" r="20" fill="%ACCENT%" opacity="0.25"/>` +
      `</svg>`,
  },
  {
    slug: "not-found",
    title: "Page not found",
    tags: ["404", "error", "not-found", "lost"],
    svg:
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 200">` +
      `<rect width="240" height="200" fill="%BG%"/>` +
      `<text x="120" y="120" font-family="sans-serif" font-size="72" font-weight="700" text-anchor="middle" fill="%ACCENT%">404</text>` +
      `<rect x="60" y="140" width="120" height="8" rx="4" fill="%DARK%" opacity="0.35"/>` +
      `</svg>`,
  },
  {
    slug: "success",
    title: "Success / done",
    tags: ["success", "done", "complete", "checkmark"],
    svg:
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 200">` +
      `<rect width="240" height="200" fill="%BG%"/>` +
      `<circle cx="120" cy="100" r="55" fill="%ACCENT%" opacity="0.15"/>` +
      `<circle cx="120" cy="100" r="38" fill="%ACCENT%"/>` +
      `<path d="M102 100l12 13 26-28" fill="none" stroke="%BG%" stroke-width="8" stroke-linecap="round" stroke-linejoin="round"/>` +
      `</svg>`,
  },
  {
    slug: "onboarding-rocket",
    title: "Onboarding / launch",
    tags: ["onboarding", "launch", "start", "rocket", "welcome"],
    svg:
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 200">` +
      `<rect width="240" height="200" fill="%BG%"/>` +
      `<path d="M120 40c22 18 26 60 14 92l-28 0c-12-32-8-74 14-92z" fill="%ACCENT%"/>` +
      `<circle cx="120" cy="82" r="10" fill="%BG%"/>` +
      `<path d="M96 118l-18 30 26-10z" fill="%DARK%"/>` +
      `<path d="M144 118l18 30-26-10z" fill="%DARK%"/>` +
      `<path d="M112 132l8 34 8-34z" fill="%ACCENT%" opacity="0.55"/>` +
      `</svg>`,
  },
  {
    slug: "security",
    title: "Security / privacy",
    tags: ["security", "privacy", "shield", "protection"],
    svg:
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 200">` +
      `<rect width="240" height="200" fill="%BG%"/>` +
      `<path d="M120 36l52 20v40c0 40-24 66-52 78-28-12-52-38-52-78V56z" fill="%ACCENT%"/>` +
      `<path d="M100 100l14 15 28-30" fill="none" stroke="%BG%" stroke-width="9" stroke-linecap="round" stroke-linejoin="round"/>` +
      `</svg>`,
  },
  {
    slug: "analytics",
    title: "Analytics / data",
    tags: ["analytics", "data", "chart", "dashboard", "stats"],
    svg:
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 200">` +
      `<rect width="240" height="200" fill="%BG%"/>` +
      `<rect x="50" y="120" width="26" height="50" rx="4" fill="%DARK%" opacity="0.4"/>` +
      `<rect x="90" y="90" width="26" height="80" rx="4" fill="%ACCENT%"/>` +
      `<rect x="130" y="60" width="26" height="110" rx="4" fill="%ACCENT%" opacity="0.7"/>` +
      `<rect x="170" y="105" width="26" height="65" rx="4" fill="%DARK%" opacity="0.4"/>` +
      `</svg>`,
  },
  {
    slug: "upload",
    title: "Upload / cloud",
    tags: ["upload", "cloud", "sync", "file"],
    svg:
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 200">` +
      `<rect width="240" height="200" fill="%BG%"/>` +
      `<path d="M80 130a30 30 0 010-60 40 40 0 0177 6 26 26 0 01-3 54H80z" fill="%ACCENT%" opacity="0.9"/>` +
      `<path d="M120 150V96m0 0l-16 16m16-16l16 16" fill="none" stroke="%BG%" stroke-width="8" stroke-linecap="round" stroke-linejoin="round"/>` +
      `</svg>`,
  },
  {
    slug: "chat",
    title: "Chat / messaging",
    tags: ["chat", "messaging", "conversation", "support"],
    svg:
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 200">` +
      `<rect width="240" height="200" fill="%BG%"/>` +
      `<rect x="55" y="60" width="130" height="80" rx="16" fill="%ACCENT%"/>` +
      `<path d="M75 140l0 24 26-24z" fill="%ACCENT%"/>` +
      `<circle cx="95" cy="100" r="7" fill="%BG%"/>` +
      `<circle cx="120" cy="100" r="7" fill="%BG%"/>` +
      `<circle cx="145" cy="100" r="7" fill="%BG%"/>` +
      `</svg>`,
  },
];

function applyPalette(svg: string, palette: [string, string, string]): string {
  return svg
    .replaceAll("%ACCENT%", palette[0])
    .replaceAll("%DARK%", palette[1])
    .replaceAll("%BG%", palette[2]);
}

function resolvePalette(spec: { palette?: string[] }): [string, string, string] {
  const p = spec.palette;
  return [p?.[0] ?? DEFAULT_PALETTE[0], p?.[1] ?? DEFAULT_PALETTE[1], p?.[2] ?? DEFAULT_PALETTE[2]];
}

export function createUndrawProvider(): AssetProvider {
  return {
    id: "undraw",
    kinds: [KIND],
    license: LICENSES.bundled,
    keyless: true,

    async search(spec): Promise<AssetCandidate[]> {
      const q = spec.query.trim().toLowerCase();
      const palette = resolvePalette(spec);
      const hits = q ? SCENES.filter((s) => s.slug.includes(q) || s.tags.some((t) => t.includes(q) || q.includes(t))) : SCENES;
      const pool = hits.length ? hits : SCENES;
      return pool.map((s, i): AssetCandidate => {
        const raw: UndrawRaw = { slug: s.slug, palette };
        return {
          id: s.slug,
          provider: "undraw",
          kind: KIND,
          title: s.title,
          tags: s.tags,
          license: LICENSES.bundled,
          score: pool.length - i,
          raw,
        };
      });
    },

    async fetch(candidate): Promise<FetchedAsset> {
      const raw = candidate.raw as UndrawRaw | undefined;
      const scene = SCENES.find((s) => s.slug === (raw?.slug ?? candidate.id));
      if (!scene) throw new Error(`undraw: unknown scene "${candidate.id}"`);
      const svg = applyPalette(scene.svg, raw?.palette ?? DEFAULT_PALETTE);
      return {
        svg,
        mime: "image/svg+xml",
        ext: "svg",
        width: 240,
        height: 200,
        kind: KIND,
        license: candidate.license,
      };
    },
  };
}
