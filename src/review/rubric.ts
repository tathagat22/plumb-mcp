/**
 * `critiqueDesign` — the DESIGN half of `plumb_review` (blueprint §9).
 *
 * Where `verifyAgainst` answers "did emit build what we authored?" (structural
 * fidelity), this answers "is what we built any *good*?" — a deterministic,
 * no-LLM rubric over six dimensions a human reviewer would grade:
 *
 *   1. hierarchy   — is there a clear dominant heading vs body?
 *   2. spacing     — does the whitespace sit on a consistent rhythm/grid?
 *   3. contrast    — does text clear the WCAG AA contrast floor (a11y)?
 *   4. alignment   — is layout driven by auto-layout, not ad-hoc absolutes?
 *   5. type-scale  — a small, harmonious set of font sizes (a real scale)?
 *   6. polish      — crafted, or does it read as a default template?
 *
 * Pure: a deterministic function of the built PDS (+ optional brief). Runs on
 * the *built* document (what actually exists in Figma now), so the score
 * reflects reality, not intent. Each dimension yields a 0–100 sub-score and a
 * list of prioritised, fix-shaped issues.
 */
import { resolveLayout } from "../normalize/resolve";
import { isPlaceholderText, parseTextToken } from "../verify";
import { aaThreshold, contrastRatio, toRgb } from "./contrast";
import type { PdsDocument, PdsNode, TokenTable } from "../pds";

export type RubricDimensionId =
  | "hierarchy"
  | "spacing"
  | "contrast"
  | "alignment"
  | "type-scale"
  | "polish";

export type RubricSeverity = "error" | "warn" | "info";

export interface RubricIssue {
  dimension: RubricDimensionId;
  severity: RubricSeverity;
  /** Built `el` the issue is anchored to, when node-specific. */
  el?: string;
  message: string;
  /** Concrete, actionable next step. */
  fix: string;
}

export interface RubricDimension {
  id: RubricDimensionId;
  label: string;
  /** 0–100. */
  score: number;
  /** Contribution to `overall`. */
  weight: number;
  issues: RubricIssue[];
}

export interface RubricResult {
  /** 0–100 weighted design score. */
  overall: number;
  dimensions: RubricDimension[];
  /** All issues, flattened and sorted error-first. */
  issues: RubricIssue[];
}

/** Optional design intent. Kept local + all-optional so this module has no
 *  hard dependency on the (separately-built) `src/design/brief.ts`. */
export interface ReviewBrief {
  /** Expected type-scale sizes in px (e.g. from Brand.type). */
  typeSizes?: number[];
  /** Expected brand font families. */
  fonts?: string[];
  /** Spacing grid base in px (default: auto-detect 8, else 4). */
  spacingBase?: number;
  /** Free-form note — echoed, not scored. */
  note?: string;
}

const WEIGHTS: Record<RubricDimensionId, number> = {
  hierarchy: 0.2,
  spacing: 0.15,
  contrast: 0.25,
  alignment: 0.15,
  "type-scale": 0.15,
  polish: 0.1,
};

const LABELS: Record<RubricDimensionId, string> = {
  hierarchy: "Visual hierarchy",
  spacing: "Spacing rhythm",
  contrast: "Contrast & a11y",
  alignment: "Alignment",
  "type-scale": "Type scale",
  polish: "Professional polish",
};

function clamp(n: number, lo = 0, hi = 100): number {
  return Math.max(lo, Math.min(hi, n));
}

/** A parsed type style for one TEXT node. */
interface TypeInfo {
  el: string;
  size: number;
  weight: number;
  family?: string;
}

/** Everything the dimensions need, gathered from one pass over the subtree. */
interface Ctx {
  pds: PdsDocument;
  tokens: TokenTable;
  reachable: string[];
  parent: Map<string, string>;
  /** TEXT nodes with a resolvable type token. */
  types: TypeInfo[];
  /** Non-zero gap + padding values across all layouts. */
  spacings: number[];
  /** Nodes that participate in placement (have layout, pos, or a parent). */
  placeable: number;
  /** Nodes positioned absolutely (carry `pos`). */
  absolute: number;
  /** Any node carries a shadow/effect. */
  hasShadow: boolean;
  /** Any node carries a non-zero radius. */
  hasRadius: boolean;
  /** Distinct solid fill hexes seen. */
  fillHexes: Set<string>;
  /** TEXT nodes whose `chars` read as placeholder/filler. */
  placeholderTexts: number;
  totalTexts: number;
}

function typeOf(node: PdsNode, tokens: TokenTable): TypeInfo | null {
  if (node.type !== "text") return null;
  if (typeof node.text !== "string" || !node.text.startsWith("$t")) return null;
  const raw = tokens.text[node.text];
  const parsed = raw ? parseTextToken(raw) : null;
  if (!parsed) return null;
  return { el: node.el, size: parsed.size, weight: parsed.weight, family: parsed.family };
}

function buildCtx(pds: PdsDocument, _brief?: ReviewBrief): Ctx {
  const tokens = pds.tokens;
  const reachable: string[] = [];
  const parent = new Map<string, string>();
  const seen = new Set<string>();
  const queue = [pds.root];
  while (queue.length) {
    const el = queue.shift();
    if (!el || seen.has(el)) continue;
    seen.add(el);
    reachable.push(el);
    const node = pds.nodes[el];
    if (node?.children) {
      for (const c of node.children) {
        if (!parent.has(c)) parent.set(c, el);
        queue.push(c);
      }
    }
  }

  const ctx: Ctx = {
    pds,
    tokens,
    reachable,
    parent,
    types: [],
    spacings: [],
    placeable: 0,
    absolute: 0,
    hasShadow: false,
    hasRadius: false,
    fillHexes: new Set(),
    placeholderTexts: 0,
    totalTexts: 0,
  };

  for (const el of reachable) {
    const node = pds.nodes[el];
    if (!node) continue;

    const ti = typeOf(node, tokens);
    if (ti) ctx.types.push(ti);

    const layout = resolveLayout(node.layout, tokens);
    if (layout) {
      if (layout.gap) ctx.spacings.push(layout.gap);
      for (const p of layout.pad) if (p > 0) ctx.spacings.push(p);
    }

    if (el !== pds.root) ctx.placeable += 1;
    if (node.pos) ctx.absolute += 1;

    if (node.shadow || node.effects) ctx.hasShadow = true;
    if (node.radius !== undefined) {
      const r =
        typeof node.radius === "string" ? tokens.radius[node.radius] : node.radius[0];
      if (r === "full" || (typeof r === "number" && r > 0)) ctx.hasRadius = true;
    }

    if (typeof node.fill === "string" && node.fill.startsWith("$c")) {
      const hex = tokens.color[node.fill];
      if (hex) ctx.fillHexes.add(hex.toLowerCase());
    }

    if (node.type === "text" && typeof node.chars === "string") {
      ctx.totalTexts += 1;
      if (isPlaceholderText(node.chars.trim(), false)) ctx.placeholderTexts += 1;
    }
  }

  return ctx;
}

/** Nearest ancestor solid-fill hex for a node — the background text sits on. */
function backgroundHex(el: string, ctx: Ctx): string | undefined {
  let cur: string | undefined = el;
  const guard = new Set<string>();
  while (cur && !guard.has(cur)) {
    guard.add(cur);
    const node = ctx.pds.nodes[cur];
    if (node) {
      // A node's own explicit solid fill, or its inheritedFill hint.
      const ref =
        typeof node.fill === "string" && node.fill.startsWith("$c")
          ? node.fill
          : node.inheritedFill;
      if (cur !== el && ref) {
        const hex = ctx.tokens.color[ref];
        if (hex) return hex;
      }
    }
    cur = ctx.parent.get(cur);
  }
  return undefined;
}

/* ----------------------------------------------------------------------- */
/* Dimension scorers                                                        */
/* ----------------------------------------------------------------------- */

function scoreTypeScale(ctx: Ctx, brief?: ReviewBrief): RubricDimension {
  const issues: RubricIssue[] = [];
  const sizes = ctx.types.map((t) => t.size);
  const distinct = Array.from(new Set(sizes)).sort((a, b) => a - b);
  let score = 100;

  if (sizes.length === 0) {
    return { id: "type-scale", label: LABELS["type-scale"], score: 70, weight: WEIGHTS["type-scale"], issues };
  }

  // Too many distinct sizes = no coherent scale. Ideal is ~3–6 steps.
  if (distinct.length > 6) {
    const over = distinct.length - 6;
    score -= Math.min(40, over * 8);
    issues.push({
      dimension: "type-scale",
      severity: "warn",
      message: `${distinct.length} distinct font sizes — that's not a scale, it's a pile.`,
      fix: "Collapse to a 4–6 step modular scale (e.g. 12/14/16/20/28/40) and reuse the steps.",
    });
  } else if (distinct.length === 1 && ctx.types.length > 2) {
    score -= 15;
    issues.push({
      dimension: "type-scale",
      severity: "warn",
      message: "Every text node is the same size — no typographic scale at all.",
      fix: "Introduce at least a heading vs body size step so the scale can carry hierarchy.",
    });
  }

  // Ratios between consecutive steps should be fairly regular (a modular scale).
  if (distinct.length >= 3) {
    const ratios: number[] = [];
    for (let i = 1; i < distinct.length; i++) {
      const prev = distinct[i - 1]!;
      const cur = distinct[i]!;
      if (prev > 0) ratios.push(cur / prev);
    }
    if (ratios.length) {
      const mean = ratios.reduce((a, b) => a + b, 0) / ratios.length;
      const variance =
        ratios.reduce((a, b) => a + (b - mean) ** 2, 0) / ratios.length;
      if (variance > 0.08) {
        score -= 15;
        issues.push({
          dimension: "type-scale",
          severity: "info",
          message: "Font-size steps are irregular — the ratios between sizes jump around.",
          fix: "Pick a consistent ratio (~1.2–1.33) between adjacent scale steps.",
        });
      }
    }
  }

  // Compare against the brief's intended scale, if provided.
  if (brief?.typeSizes && brief.typeSizes.length) {
    const expected = brief.typeSizes;
    const off = distinct.filter(
      (s) => !expected.some((e) => Math.abs(e - s) <= 1),
    );
    if (off.length) {
      score -= Math.min(20, off.length * 6);
      issues.push({
        dimension: "type-scale",
        severity: "warn",
        message: `Font sizes ${off.join(", ")}px aren't in the brief's type scale.`,
        fix: `Snap them to the intended scale: ${expected.join(", ")}px.`,
      });
    }
  }

  return { id: "type-scale", label: LABELS["type-scale"], score: clamp(score), weight: WEIGHTS["type-scale"], issues };
}

function scoreHierarchy(ctx: Ctx): RubricDimension {
  const issues: RubricIssue[] = [];
  const sizes = ctx.types.map((t) => t.size).sort((a, b) => b - a);
  if (sizes.length < 2) {
    return { id: "hierarchy", label: LABELS.hierarchy, score: 70, weight: WEIGHTS.hierarchy, issues };
  }
  const top = sizes[0]!;
  // "Body" ≈ the most common size (the mode), the text a reader spends time on.
  const counts = new Map<number, number>();
  for (const s of ctx.types.map((t) => t.size)) counts.set(s, (counts.get(s) ?? 0) + 1);
  let body = sizes[sizes.length - 1]!;
  let best = -1;
  for (const [s, c] of counts) {
    if (c > best || (c === best && s < body)) {
      best = c;
      body = s;
    }
  }
  const ratio = body > 0 ? top / body : 1;

  let score = 100;
  if (ratio < 1.2) {
    score = 45;
    issues.push({
      dimension: "hierarchy",
      severity: "warn",
      message: `Largest text is only ${ratio.toFixed(2)}× the body size — hierarchy reads flat.`,
      fix: "Make the primary heading clearly dominant (aim for ≥1.5× the body size), or add weight/colour contrast.",
    });
  } else if (ratio < 1.5) {
    score = 75;
    issues.push({
      dimension: "hierarchy",
      severity: "info",
      message: `Heading-to-body ratio is modest (${ratio.toFixed(2)}×).`,
      fix: "Consider a bolder size or weight step to strengthen the focal point.",
    });
  }

  // Weight variation reinforces hierarchy; all-one-weight is a soft miss.
  const weights = new Set(ctx.types.map((t) => t.weight));
  if (weights.size === 1 && ctx.types.length > 3) {
    score -= 10;
    issues.push({
      dimension: "hierarchy",
      severity: "info",
      message: "Every text node shares one font weight.",
      fix: "Use a heavier weight on headings/labels to separate levels.",
    });
  }

  return { id: "hierarchy", label: LABELS.hierarchy, score: clamp(score), weight: WEIGHTS.hierarchy, issues };
}

function scoreSpacing(ctx: Ctx, brief?: ReviewBrief): RubricDimension {
  const issues: RubricIssue[] = [];
  const vals = ctx.spacings;
  if (vals.length === 0) {
    return { id: "spacing", label: LABELS.spacing, score: 80, weight: WEIGHTS.spacing, issues };
  }
  // Detect the grid base: prefer the brief's, else 8 if most values divide by
  // it, else 4.
  const base =
    brief?.spacingBase ??
    (vals.filter((v) => v % 8 === 0).length / vals.length >= 0.6 ? 8 : 4);
  const onGrid = vals.filter((v) => v % base === 0).length;
  const onGridShare = onGrid / vals.length;

  let score = Math.round(onGridShare * 100);
  if (onGridShare < 0.85) {
    const off = Array.from(new Set(vals.filter((v) => v % base !== 0))).sort((a, b) => a - b);
    issues.push({
      dimension: "spacing",
      severity: onGridShare < 0.6 ? "warn" : "info",
      message: `${Math.round((1 - onGridShare) * 100)}% of gaps/padding are off the ${base}px grid (${off.slice(0, 8).join(", ")}${off.length > 8 ? "…" : ""}).`,
      fix: `Snap spacing to multiples of ${base}px so the layout has a consistent rhythm.`,
    });
  }

  // Too many distinct spacing values = no rhythm even if each divides the grid.
  const distinct = new Set(vals).size;
  if (distinct > 8) {
    score -= Math.min(25, (distinct - 8) * 4);
    issues.push({
      dimension: "spacing",
      severity: "info",
      message: `${distinct} distinct spacing values in use.`,
      fix: "Restrict to a small spacing scale (e.g. 4/8/12/16/24/32/48).",
    });
  }

  return { id: "spacing", label: LABELS.spacing, score: clamp(score), weight: WEIGHTS.spacing, issues };
}

function scoreContrast(ctx: Ctx): RubricDimension {
  const issues: RubricIssue[] = [];
  let checked = 0;
  let passed = 0;
  for (const t of ctx.types) {
    const node = ctx.pds.nodes[t.el];
    if (!node) continue;
    if (typeof node.fill !== "string" || !node.fill.startsWith("$c")) continue;
    const fgHex = ctx.tokens.color[node.fill];
    // Don't fabricate a white background for gradient/image surfaces — that
    // mis-grades text on photos/gradients. Skip when the bg can't be resolved.
    const bgHex = backgroundHex(t.el, ctx);
    if (!bgHex) continue;
    const fg = toRgb(fgHex);
    const bg = toRgb(bgHex);
    if (!fg || !bg) continue; // gradient/image bg or unparseable — can't judge
    checked += 1;
    const ratio = contrastRatio(fg, bg);
    const need = aaThreshold(t.size, t.weight);
    if (ratio >= need) {
      passed += 1;
    } else {
      issues.push({
        dimension: "contrast",
        severity: "error",
        el: t.el,
        message: `Text contrast ${ratio.toFixed(2)}:1 fails WCAG AA (needs ${need}:1) — ${fgHex} on ${bgHex}.`,
        fix: `Darken the text or lighten the background until it clears ${need}:1.`,
      });
    }
  }
  if (checked === 0) {
    return { id: "contrast", label: LABELS.contrast, score: 85, weight: WEIGHTS.contrast, issues };
  }
  const score = Math.round((passed / checked) * 100);
  return { id: "contrast", label: LABELS.contrast, score: clamp(score), weight: WEIGHTS.contrast, issues };
}

function scoreAlignment(ctx: Ctx): RubricDimension {
  const issues: RubricIssue[] = [];
  if (ctx.placeable === 0) {
    return { id: "alignment", label: LABELS.alignment, score: 80, weight: WEIGHTS.alignment, issues };
  }
  const absShare = ctx.absolute / ctx.placeable;
  // Auto-layout adoption is the alignment backbone; heavy absolute positioning
  // is where drift and misalignment creep in.
  const score = Math.round((1 - absShare) * 100);
  if (absShare > 0.25) {
    issues.push({
      dimension: "alignment",
      severity: absShare > 0.5 ? "warn" : "info",
      message: `${Math.round(absShare * 100)}% of nodes are absolutely positioned.`,
      fix: "Wrap ad-hoc absolute children in auto-layout frames so alignment is structural, not hand-placed.",
    });
  }
  return { id: "alignment", label: LABELS.alignment, score: clamp(score), weight: WEIGHTS.alignment, issues };
}

function scorePolish(ctx: Ctx): RubricDimension {
  const issues: RubricIssue[] = [];
  // Checklist of craft signals; each worth points toward 100.
  let score = 40; // a bare, template-y baseline

  if (ctx.hasShadow) score += 15;
  else
    issues.push({
      dimension: "polish",
      severity: "info",
      message: "No elevation anywhere — surfaces read flat/templated.",
      fix: "Add a subtle shadow to cards/overlays to create depth where it helps.",
    });

  if (ctx.hasRadius) score += 10;
  else
    issues.push({
      dimension: "polish",
      severity: "info",
      message: "No rounded corners — everything is hard-edged.",
      fix: "Apply a consistent corner radius to buttons/cards/inputs unless a sharp look is intended.",
    });

  // A considered palette (more than black+white, fewer than a riot of colours).
  const palette = ctx.fillHexes.size;
  if (palette >= 3 && palette <= 12) score += 15;
  else if (palette > 12)
    issues.push({
      dimension: "polish",
      severity: "info",
      message: `${palette} distinct fill colours — the palette looks unmanaged.`,
      fix: "Consolidate to a small brand palette (bg/surface/text/primary + a few accents).",
    });
  else if (palette <= 2)
    issues.push({
      dimension: "polish",
      severity: "info",
      message: "Palette is essentially black on white.",
      fix: "Introduce brand colour and considered greys so it doesn't read as an unstyled wireframe.",
    });

  // Real content, not lorem/placeholder filler everywhere.
  if (ctx.totalTexts > 0) {
    const fillerShare = ctx.placeholderTexts / ctx.totalTexts;
    if (fillerShare < 0.5) score += 20;
    else
      issues.push({
        dimension: "polish",
        severity: "warn",
        message: `${Math.round(fillerShare * 100)}% of text is placeholder/filler.`,
        fix: "Replace lorem/stub copy with real, specific content — filler is the #1 templated tell.",
      });
  } else {
    score += 10;
  }

  return { id: "polish", label: LABELS.polish, score: clamp(score), weight: WEIGHTS.polish, issues };
}

const RANK: Record<RubricSeverity, number> = { error: 0, warn: 1, info: 2 };

/** Run the full six-dimension design critique over a built PDS. */
export function critiqueDesign(pds: PdsDocument, brief?: ReviewBrief): RubricResult {
  const ctx = buildCtx(pds, brief);
  const dimensions: RubricDimension[] = [
    scoreHierarchy(ctx),
    scoreSpacing(ctx, brief),
    scoreContrast(ctx),
    scoreAlignment(ctx),
    scoreTypeScale(ctx, brief),
    scorePolish(ctx),
  ];

  const overall = Math.round(
    dimensions.reduce((sum, d) => sum + d.score * d.weight, 0),
  );

  const issues = dimensions
    .flatMap((d) => d.issues)
    .sort((a, b) => RANK[a.severity] - RANK[b.severity]);

  return { overall: clamp(overall), dimensions, issues };
}
