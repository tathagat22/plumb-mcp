/**
 * Ranking — one scoring function for every provider.
 *
 * Providers return wildly different metadata, so ranking has to work from what
 * they all share: the query terms, the declared style, and how much the
 * provider is trusted for that kind. `pickIconPack` is the part that matters
 * visually — it forces a whole design onto ONE icon family, because mixed icon
 * packs are the single most obvious tell that a UI was assembled rather than
 * designed.
 */

import type { AssetSpec, StyleTag } from "../../dsl/schema";
import type { AssetCandidate } from "./contracts";

// ============================================================================
// Ranking — one scoring function for every provider
// ============================================================================

export const PROVIDER_RANK: Record<string, number> = {
  iconify: 0.9,
  unsplash: 0.9,
  pexels: 0.85,
  pixabay: 0.8,
  dicebear: 0.8,
  picsum: 0.4,
};

/** Iconify prefixes → the style family they read as, for weight/style affinity. */
export const PREFIX_STYLE: Record<string, StyleTag[]> = {
  ph: ["line", "duotone", "outline"],
  lucide: ["line", "outline"],
  tabler: ["line", "outline"],
  "mdi-light": ["line", "outline"],
  mdi: ["filled", "flat"],
  "material-symbols": ["filled", "outline"],
  "material-symbols-light": ["outline", "line"],
  carbon: ["line", "outline"],
  solar: ["line", "duotone", "filled"],
  "fluent-emoji": ["3d"],
  "fluent-emoji-flat": ["flat"],
  noto: ["3d"],
  "twemoji": ["flat"],
  heroicons: ["outline", "filled", "line"],
  "heroicons-outline": ["outline", "line"],
  "heroicons-solid": ["filled"],
  bi: ["filled", "line"],
  fa6: ["filled"],
  "fa6-regular": ["outline", "line"],
};

export function tokenize(s: string): string[] {
  return s.toLowerCase().match(/[a-z0-9]+/g) ?? [];
}

/** Fraction of `needles` present in `haystack`. */
export function overlap(needles: string[], haystack: Set<string>): number {
  if (needles.length === 0) return 0;
  let hit = 0;
  for (const n of needles) if (haystack.has(n)) hit++;
  return hit / needles.length;
}

/** Score a single candidate against the spec (roughly 0..1.2). */
export function scoreCandidate(c: AssetCandidate, spec: AssetSpec): number {
  const q = tokenize(spec.query);
  const hay = new Set(
    tokenize([c.title ?? "", (c.tags ?? []).join(" "), c.id].join(" ")),
  );
  let s = 0.45 * overlap(q, hay);

  if (spec.kind) s += c.kind === spec.kind ? 0.2 : -0.15;

  if (spec.style?.length && c.style?.length) {
    const cs = new Set(c.style as string[]);
    let so = 0;
    for (const want of spec.style) if (cs.has(want)) so++;
    s += 0.15 * (so / spec.style.length);
  }

  if (spec.weight && c.weight) s += c.weight === spec.weight ? 0.08 : 0;

  if (spec.aspect && c.w && c.h) {
    const a = c.w / c.h;
    const d = Math.abs(a - spec.aspect) / spec.aspect;
    s += 0.1 * Math.max(0, 1 - d);
  }

  if (spec.minWidth && c.w && c.w < spec.minWidth) s -= 0.15;

  s += 0.12 * (PROVIDER_RANK[c.provider] ?? 0.5);
  return s;
}

/** Score + sort candidates in place-safe fashion (returns a new sorted array). */
export function rankCandidates(cands: AssetCandidate[], spec: AssetSpec): AssetCandidate[] {
  const scored = cands.map((c) => ({ ...c, score: scoreCandidate(c, spec) }));
  scored.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
  return scored;
}

/**
 * Pick-the-right-pack: from a ranked list of iconify candidates, lock onto ONE
 * prefix (icon family) so a whole design uses a consistent set. The winning
 * prefix is the one whose members carry the most ranking weight, nudged by how
 * well the prefix's known style matches the requested style/weight.
 */
export function pickIconPack(
  ranked: AssetCandidate[],
  spec: AssetSpec,
): { prefix?: string; candidates: AssetCandidate[] } {
  const icons = ranked.filter((c) => c.provider === "iconify" && c.kind === "icon");
  if (icons.length === 0) return { candidates: ranked };

  const wantStyle = new Set((spec.style ?? []) as string[]);
  const packWeight = new Map<string, number>();
  for (const c of icons) {
    const prefix = c.id.includes(":") ? c.id.slice(0, c.id.indexOf(":")) : c.provider;
    let w = (c.score ?? 0) + 0.15; // per-member presence bonus
    const styles = PREFIX_STYLE[prefix];
    if (styles && wantStyle.size > 0) {
      const affinity = styles.filter((st) => wantStyle.has(st)).length;
      w += 0.25 * affinity;
    }
    packWeight.set(prefix, (packWeight.get(prefix) ?? 0) + w);
  }

  let best: string | undefined;
  let bestW = -Infinity;
  for (const [prefix, w] of packWeight) {
    if (w > bestW) {
      bestW = w;
      best = prefix;
    }
  }
  if (!best) return { candidates: ranked };

  const locked = icons.filter(
    (c) => (c.id.includes(":") ? c.id.slice(0, c.id.indexOf(":")) : c.provider) === best,
  );
  return { prefix: best, candidates: locked };
}
