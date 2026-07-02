/**
 * Device mockup frames — keyless, bundled (blueprint: "device mockups").
 * Freshly authored generic frames (not a specific real device's trademarked
 * shape) for phone/tablet/laptop/browser/watch. Each `MockupRecipe.frameSvg`
 * carries a `<rect id="plumb-content-slot">` marking where a screenshot
 * should be composited/clipped; `contentRect` gives the same rect's geometry
 * in the frame's own coordinate space so a compositor doesn't have to
 * re-parse the SVG. `getMockupRecipe`/`MOCKUP_RECIPES` are exported directly
 * for callers (e.g. the future `src/dsl/blocks.ts` Image-with-mockup
 * lowering) that need the structured recipe, not just the flat
 * `AssetProvider` shape.
 */

import type { AssetProvider } from "./index";
import type { AssetCandidate, FetchedAsset, MockupRecipe } from "../types";
import { LICENSES } from "../types";

const KIND = "mockup" as const;

export const MOCKUP_RECIPES: MockupRecipe[] = [
  {
    id: "phone",
    label: "Phone",
    device: "phone",
    canvasW: 300,
    canvasH: 610,
    contentRect: { x: 20, y: 20, w: 260, h: 570 },
    frameSvg:
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 610">` +
      `<rect x="4" y="4" width="292" height="602" rx="44" fill="#1a1a1a"/>` +
      `<rect id="plumb-content-slot" x="20" y="20" width="260" height="570" rx="30" fill="#ffffff"/>` +
      `<rect x="110" y="14" width="80" height="14" rx="7" fill="#1a1a1a"/>` +
      `</svg>`,
  },
  {
    id: "tablet",
    label: "Tablet",
    device: "tablet",
    canvasW: 520,
    canvasH: 700,
    contentRect: { x: 24, y: 24, w: 472, h: 652 },
    frameSvg:
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 520 700">` +
      `<rect x="4" y="4" width="512" height="692" rx="28" fill="#1a1a1a"/>` +
      `<rect id="plumb-content-slot" x="24" y="24" width="472" height="652" rx="10" fill="#ffffff"/>` +
      `<circle cx="260" cy="14" r="4" fill="#3a3a3a"/>` +
      `</svg>`,
  },
  {
    id: "laptop",
    label: "Laptop",
    device: "laptop",
    canvasW: 720,
    canvasH: 470,
    contentRect: { x: 60, y: 24, w: 600, h: 375 },
    frameSvg:
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 720 470">` +
      `<rect x="40" y="4" width="640" height="410" rx="14" fill="#2b2b2b"/>` +
      `<rect id="plumb-content-slot" x="60" y="24" width="600" height="375" fill="#ffffff"/>` +
      `<path d="M0 440h720l-30 26H30z" fill="#3a3a3a"/>` +
      `<rect x="300" y="440" width="120" height="8" rx="4" fill="#1a1a1a"/>` +
      `</svg>`,
  },
  {
    id: "browser",
    label: "Browser window",
    device: "browser",
    canvasW: 720,
    canvasH: 480,
    contentRect: { x: 0, y: 44, w: 720, h: 436 },
    frameSvg:
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 720 480">` +
      `<rect width="720" height="480" rx="12" fill="#e6e8eb"/>` +
      `<rect width="720" height="44" rx="12" fill="#d4d7db"/>` +
      `<rect y="20" width="720" height="24" fill="#d4d7db"/>` +
      `<circle cx="24" cy="22" r="6" fill="#ff5f57"/>` +
      `<circle cx="46" cy="22" r="6" fill="#febc2e"/>` +
      `<circle cx="68" cy="22" r="6" fill="#28c840"/>` +
      `<rect x="100" y="12" width="520" height="20" rx="10" fill="#ffffff"/>` +
      `<rect id="plumb-content-slot" x="0" y="44" width="720" height="436" fill="#ffffff"/>` +
      `</svg>`,
  },
  {
    id: "watch",
    label: "Smartwatch",
    device: "watch",
    canvasW: 260,
    canvasH: 300,
    contentRect: { x: 30, y: 30, w: 200, h: 200 },
    frameSvg:
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 260 300">` +
      `<rect x="90" y="0" width="80" height="40" rx="10" fill="#1a1a1a"/>` +
      `<rect x="90" y="260" width="80" height="40" rx="10" fill="#1a1a1a"/>` +
      `<rect x="10" y="20" width="240" height="260" rx="56" fill="#1a1a1a"/>` +
      `<rect id="plumb-content-slot" x="30" y="40" width="200" height="220" rx="40" fill="#ffffff"/>` +
      `</svg>`,
  },
];

export function getMockupRecipe(id: string): MockupRecipe | undefined {
  return MOCKUP_RECIPES.find((m) => m.id === id);
}

function matchDevice(recipe: MockupRecipe, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const aliases: Record<string, string[]> = {
    phone: ["phone", "iphone", "mobile", "smartphone", "android"],
    tablet: ["tablet", "ipad"],
    laptop: ["laptop", "macbook", "notebook", "computer"],
    browser: ["browser", "window", "web", "desktop", "chrome", "safari"],
    watch: ["watch", "smartwatch", "apple watch", "wearable"],
  };
  return (aliases[recipe.device] ?? [recipe.device]).some((a) => a.includes(q) || q.includes(a));
}

export function createMockupsProvider(): AssetProvider {
  return {
    id: "mockups",
    kinds: [KIND],
    license: LICENSES.bundled,
    keyless: true,

    async search(spec): Promise<AssetCandidate[]> {
      const hits = MOCKUP_RECIPES.filter((m) => matchDevice(m, spec.query));
      const pool = hits.length ? hits : MOCKUP_RECIPES;
      return pool.map((m, i): AssetCandidate => ({
        id: m.id,
        provider: "mockups",
        kind: KIND,
        title: m.label,
        tags: [m.device],
        width: m.canvasW,
        height: m.canvasH,
        license: LICENSES.bundled,
        score: pool.length - i,
        raw: { id: m.id },
      }));
    },

    async fetch(candidate): Promise<FetchedAsset> {
      const recipe = getMockupRecipe(candidate.id);
      if (!recipe) throw new Error(`mockups: unknown recipe "${candidate.id}"`);
      return {
        svg: recipe.frameSvg,
        mime: "image/svg+xml",
        ext: "svg",
        width: recipe.canvasW,
        height: recipe.canvasH,
        kind: KIND,
        license: candidate.license,
      };
    },
  };
}
