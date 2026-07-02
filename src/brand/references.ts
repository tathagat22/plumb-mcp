/**
 * Reference discovery — step 1 of the design director.
 *
 * Given a brief ("a premium fintech dashboard"), pick a small, DIVERSE set of
 * real, best-in-class websites to study and screenshot. This is deliberately a
 * curated catalogue rather than a live web search: the whole point of a
 * reference pass is TASTE, and a hand-picked shortlist of sites that actually
 * win on craft beats whatever a keyword search returns. An optional LLM/search
 * expansion can layer on top later; user-supplied URLs always take priority.
 */

export interface Reference {
  url: string;
  /** Display name for the board label. */
  name: string;
  /** One line on what makes it worth studying — shown under the screenshot. */
  why: string;
  /** Match tags: system types, industries, and aesthetic keywords. */
  tags: string[];
}

/**
 * The catalogue. Each entry is a site that clears a genuine craft bar, tagged
 * so the brief can pull the right few. Kept broad enough to cover the common
 * "premium / professional" briefs (dashboards, SaaS, fintech, dev tools,
 * luxury, portfolio, commerce, AI products) without becoming a link dump.
 */
const CATALOGUE: Reference[] = [
  // ── Dev tools / SaaS / dashboards ──────────────────────────────────────
  { url: "https://linear.app", name: "Linear", why: "The reference for dark, keyboard-first product UI — LCH color system, razor type, restrained motion.", tags: ["saas", "dashboard", "dev-tool", "productivity", "dark", "minimal", "premium", "b2b"] },
  { url: "https://vercel.com", name: "Vercel", why: "Geist system: near-black ground, a single blue accent, a strict neutral ramp, sharp corners.", tags: ["saas", "dev-tool", "platform", "dark", "minimal", "premium", "infrastructure"] },
  { url: "https://stripe.com", name: "Stripe", why: "The gold standard for fintech marketing — the animated mesh gradient, Söhne type, layered soft shadows.", tags: ["fintech", "finance", "payments", "saas", "b2b", "gradient", "premium", "light"] },
  { url: "https://www.mercury.com", name: "Mercury", why: "Premium fintech with a calm, editorial palette and generous whitespace — banking that feels designed.", tags: ["fintech", "finance", "banking", "b2b", "premium", "light", "editorial"] },
  { url: "https://ramp.com", name: "Ramp", why: "Confident finance product marketing — bold type scale, tight grid, restrained accent.", tags: ["fintech", "finance", "saas", "b2b", "premium", "spend", "corporate"] },
  { url: "https://posthog.com", name: "PostHog", why: "Analytics/dashboard product with dense data UI treated with real craft.", tags: ["analytics", "dashboard", "dev-tool", "saas", "data", "b2b"] },
  { url: "https://resend.com", name: "Resend", why: "Minimal developer product — beautiful restraint, mono accents, perfect spacing rhythm.", tags: ["dev-tool", "saas", "email", "minimal", "dark", "premium", "infrastructure"] },

  // ── AI products ────────────────────────────────────────────────────────
  { url: "https://openai.com", name: "OpenAI", why: "Restrained, near-monochrome AI brand — enormous whitespace, quiet confidence.", tags: ["ai", "product", "minimal", "light", "premium", "research"] },
  { url: "https://www.anthropic.com", name: "Anthropic", why: "Warm off-white editorial system with a serif/grotesque pairing — human, considered AI.", tags: ["ai", "product", "editorial", "warm", "light", "premium", "research"] },

  // ── Luxury / brand / automotive ────────────────────────────────────────
  { url: "https://www.apple.com", name: "Apple", why: "The single-hero-product discipline — full-bleed cinematic imagery, SF Pro, scroll storytelling.", tags: ["luxury", "consumer", "product", "hardware", "premium", "cinematic", "automotive", "minimal"] },
  { url: "https://www.porsche.com", name: "Porsche", why: "Automotive luxury — dark cinematic photography, tight type, one metallic accent.", tags: ["luxury", "automotive", "car", "premium", "dark", "cinematic", "brand"] },
  { url: "https://www.teenage.engineering", name: "Teenage Engineering", why: "Constraint as identity — monospace, a tiny palette, playful industrial rigor.", tags: ["brand", "hardware", "product", "playful", "editorial", "minimal", "constrained"] },

  // ── Agency / portfolio / awwwards-caliber ──────────────────────────────
  { url: "https://lusion.co", name: "Lusion", why: "Most-decorated WebGL studio — the ceiling for signature interactive moments.", tags: ["agency", "portfolio", "creative", "awwwards", "webgl", "3d", "experimental", "dark"] },
  { url: "https://www.active-theory.com", name: "Active Theory", why: "Immersive, cinematic interactive work — reference for a signature hero moment.", tags: ["agency", "portfolio", "creative", "awwwards", "webgl", "3d", "experimental", "immersive"] },

  // ── Commerce / consumer ────────────────────────────────────────────────
  { url: "https://www.gymshark.com", name: "Gymshark", why: "Bold consumer commerce — strong imagery, high-contrast type, confident CTAs.", tags: ["ecommerce", "retail", "consumer", "brand", "bold", "commerce"] },
  { url: "https://www.allbirds.com", name: "Allbirds", why: "Clean, natural commerce — soft neutral palette, generous product photography.", tags: ["ecommerce", "retail", "consumer", "natural", "light", "commerce", "sustainable"] },
];

/** A parsed brief — only the fields discovery needs. */
export interface RefBrief {
  /** Free-text description of what's being built. */
  description?: string;
  industry?: string;
  keywords?: string[];
  /** Aesthetic/tone words, e.g. ["premium","dark","editorial"]. */
  tone?: string[];
  /** Explicit references the user already has in mind — always included first. */
  references?: string[];
}

const STOP = new Set(["a", "an", "the", "for", "with", "and", "of", "to", "app", "site", "website", "page", "landing", "build", "make", "create", "design"]);

/** Loose tokens from all brief text, lowercased, stop-words dropped. */
function briefTokens(brief: RefBrief): string[] {
  const bag = [brief.description ?? "", brief.industry ?? "", ...(brief.keywords ?? []), ...(brief.tone ?? [])]
    .join(" ")
    .toLowerCase();
  const words = bag.split(/[^a-z0-9+]+/).filter((w) => w.length > 1 && !STOP.has(w));
  return words;
}

/** Turn a bare URL into a Reference (for user-supplied refs). */
function userRef(url: string): Reference {
  let host = url;
  try {
    host = new URL(url.startsWith("http") ? url : `https://${url}`).hostname.replace(/^www\./, "");
  } catch {
    /* keep raw */
  }
  return {
    url: url.startsWith("http") ? url : `https://${url}`,
    name: host,
    why: "Reference supplied in the brief.",
    tags: [],
  };
}

/** Alias common industry/system words to catalogue tags for better recall. */
const SYNONYMS: Record<string, string[]> = {
  bank: ["fintech", "finance"],
  banking: ["fintech", "finance"],
  finance: ["fintech"],
  financial: ["fintech", "finance"],
  payment: ["fintech", "payments"],
  payments: ["fintech"],
  admin: ["dashboard", "saas"],
  analytics: ["dashboard", "data"],
  developer: ["dev-tool"],
  devtool: ["dev-tool"],
  infra: ["infrastructure", "platform"],
  car: ["automotive"],
  vehicle: ["automotive"],
  auto: ["automotive"],
  shop: ["ecommerce", "commerce"],
  store: ["ecommerce", "commerce"],
  retail: ["ecommerce"],
  agency: ["agency", "portfolio"],
  studio: ["agency", "portfolio", "creative"],
  portfolio: ["portfolio", "creative"],
  award: ["awwwards", "creative"],
  awwwards: ["awwwards", "creative", "experimental"],
  llm: ["ai"],
  premium: ["premium", "luxury"],
  luxury: ["luxury", "premium"],
};

/**
 * Pick the best `count` references for the brief. User-supplied refs come
 * first; the rest are scored by tag overlap and de-duplicated by name so the
 * board stays diverse. Falls back to a strong default set for a vague brief.
 */
export function discoverReferences(brief: RefBrief, count = 4): Reference[] {
  const picked: Reference[] = [];
  const seen = new Set<string>();
  const take = (r: Reference): void => {
    if (seen.has(r.name)) return;
    seen.add(r.name);
    picked.push(r);
  };

  // 1. Anything the user named explicitly wins.
  for (const u of brief.references ?? []) take(userRef(u));

  // 2. Expand brief tokens through synonyms into a weighted want-set.
  const tokens = briefTokens(brief);
  const wants = new Map<string, number>();
  for (const t of tokens) {
    wants.set(t, (wants.get(t) ?? 0) + 1);
    for (const syn of SYNONYMS[t] ?? []) wants.set(syn, (wants.get(syn) ?? 0) + 1);
  }

  // 3. Score the catalogue by tag overlap.
  const scored = CATALOGUE.map((r) => {
    let score = 0;
    for (const tag of r.tags) if (wants.has(tag)) score += wants.get(tag)!;
    // A gentle nudge toward broadly-premium exemplars breaks ties sensibly.
    if (r.tags.includes("premium")) score += 0.1;
    return { r, score };
  }).sort((a, b) => b.score - a.score);

  for (const { r, score } of scored) {
    if (picked.length >= count) break;
    if (score <= 0) continue;
    take(r);
  }

  // 4. Vague brief (no matches): fall back to a versatile premium default set.
  if (picked.length < count) {
    for (const name of ["Linear", "Stripe", "Apple", "Vercel"]) {
      if (picked.length >= count) break;
      const r = CATALOGUE.find((c) => c.name === name);
      if (r) take(r);
    }
  }

  return picked.slice(0, count);
}
