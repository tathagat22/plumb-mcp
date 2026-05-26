/**
 * plumb_verify's comparison engine (plan §8).
 *
 * Pure: given a PDS and the agent's rendered layout, produce a sorted list of
 * structured deltas (no CV, no pixel diff). Every comparison is tolerance-aware
 * and edge-case-careful.
 */
import type { PdsDocument, PdsNode, TokenTable } from "./pds";

export interface RenderedElement {
  el: string;
  box: { x: number; y: number; w: number; h: number };
  text?: string;
  styles?: Record<string, string>;
}

export interface Tolerances {
  px: { ok: number; warn: number };
  color: { ok: number; warn: number };
}

export const DEFAULT_TOLERANCES: Tolerances = {
  px: { ok: 1, warn: 3 },
  color: { ok: 6, warn: 24 },
};

export type Severity = "error" | "warn" | "info";

export interface Delta {
  el: string;
  /** Mirrors PdsNode.name — undefined when Figma's name was auto-generated. */
  name?: string;
  kind: string;
  expected: string | number | null;
  actual: string | number | null;
  diff?: number;
  severity: Severity;
}

export interface CoverageInfo {
  pdsTotal: number;
  matched: number;
  coverage: number; // 0..1 ratio
  /**
   * `el`s present in the PDS subtree but NOT in `rendered`. Prioritised so
   * "important" untagged nodes (fills, text, effects, interactive surfaces)
   * float to the top — these are usually the ones an agent forgot to tag.
   */
  untagged: string[];
}

export interface VerifyResult {
  matched: number;
  rendered: number;
  unmatched: number;
  ok: boolean;
  deltas: Delta[];
  truncated?: boolean;
  coverage?: CoverageInfo;
}

const MAX_DELTAS = 150;

/** Run the full comparison. Always returns a result — no throws. */
export function verifyAgainst(
  pds: PdsDocument,
  rendered: RenderedElement[],
  tolerances: Tolerances = DEFAULT_TOLERANCES,
): VerifyResult {
  // The rendered set's keys can be either the short `el` handle or the
  // globally-unique dotted `path`; build both lookup tables so agents that
  // tagged deep-nested DOM with `path` aren't punished. PDS keys are `el`s, so
  // we index `pds.nodes` by both surfaces here.
  const byEl = new Map<string, PdsNode>();
  const byPath = new Map<string, PdsNode>();
  for (const el of Object.keys(pds.nodes)) {
    const node = pds.nodes[el];
    if (!node) continue;
    byEl.set(el, node);
    if (node.path) byPath.set(node.path, node);
  }

  const deltas: Delta[] = [];
  let matched = 0;
  let unmatched = 0;
  const matchedEls = new Set<string>();

  for (const r of rendered) {
    if (deltas.length >= MAX_DELTAS) break;
    const node = byEl.get(r.el) ?? byPath.get(r.el);
    if (!node) {
      unmatched += 1;
      deltas.push({
        el: r.el,
        name: r.el,
        kind: "missing-in-pds",
        expected: null,
        actual: r.el,
        severity: "warn",
      });
      continue;
    }
    matched += 1;
    matchedEls.add(node.el);
    compareOne(node, r, pds.tokens, tolerances, deltas);
  }

  // Coverage: the verifier's most useful affordance, per real-world feedback.
  // "All 10 matched / 0 deltas" lies if the screen had 47 tag-worthy nodes
  // and you only checked the skeleton. Compute and surface the gap so the
  // agent knows what to tag on the next round.
  const coverage = computeCoverage(pds, matchedEls);

  deltas.sort(
    (a, b) =>
      severityRank(a.severity) - severityRank(b.severity) ||
      (b.diff ?? 0) - (a.diff ?? 0),
  );

  const truncated = deltas.length > MAX_DELTAS;
  if (truncated) deltas.length = MAX_DELTAS;

  const ok = deltas.every((d) => d.severity !== "error");
  const base: VerifyResult = {
    matched,
    rendered: rendered.length,
    unmatched,
    ok,
    deltas,
    coverage,
  };
  if (truncated) base.truncated = true;
  return base;
}

/**
 * "Important" PDS nodes are the ones an agent usually wants to verify but
 * commonly forgets — anything with a visible fill, text, effect, image, or
 * radius. Skeleton frames without any of these are unlikely to surface bugs.
 */
function isImportantNode(node: PdsNode): boolean {
  if (node.text || node.chars) return true;
  if (node.fill || node.fills) return true;
  if (node.effects || node.shadow || node.backdropFilter) return true;
  if (node.assetId) return true;
  if (node.radius !== undefined) return true;
  if (node.iconHint) return true;
  return false;
}

function computeCoverage(pds: PdsDocument, matchedEls: Set<string>): CoverageInfo {
  // Collect every reachable PDS node under the requested root (skip orphans
  // that exist in the flat map but aren't in the requested subtree).
  const reachable = new Set<string>();
  const queue: string[] = [pds.root];
  while (queue.length) {
    const el = queue.shift();
    if (!el || reachable.has(el)) continue;
    reachable.add(el);
    const node = pds.nodes[el];
    if (node?.children) queue.push(...node.children);
  }
  const importantUntagged: string[] = [];
  const plainUntagged: string[] = [];
  for (const el of reachable) {
    if (matchedEls.has(el)) continue;
    const node = pds.nodes[el];
    if (!node) continue;
    if (isImportantNode(node)) importantUntagged.push(el);
    else plainUntagged.push(el);
  }
  // Cap the surfaced list — agents don't need 200 names, the top ~20 is plenty
  // to identify what to add to the next round of tagging.
  const untagged = importantUntagged
    .concat(plainUntagged)
    .slice(0, 20);
  const pdsTotal = reachable.size;
  const coverage = pdsTotal === 0 ? 1 : matchedEls.size / pdsTotal;
  return {
    pdsTotal,
    matched: matchedEls.size,
    coverage: Math.round(coverage * 100) / 100,
    untagged,
  };
}

/* ---------------------------------------------------------------------- */
/* compareOne — every typed check                                          */
/* ---------------------------------------------------------------------- */

function compareOne(
  node: PdsNode,
  r: RenderedElement,
  tokens: TokenTable,
  tol: Tolerances,
  deltas: Delta[],
): void {
  const styles = r.styles ?? {};

  // Numeric diff helper — uses tol.px by default; pass overrides for text.size etc.
  const pushPx = (
    kind: string,
    expected: number,
    actual: number,
    custom?: { ok: number; warn: number },
  ): void => {
    const diff = Math.abs(expected - actual);
    const t = custom ?? tol.px;
    if (diff <= t.ok) return;
    const severity: Severity = diff > t.warn ? "error" : "warn";
    deltas.push({ el: node.el, name: node.name, kind, expected, actual, diff, severity });
  };

  // --- Size ----------------------------------------------------------------
  if (node.box.w > 0 && r.box.w > 0) pushPx("size.w", node.box.w, r.box.w);
  if (node.box.h > 0 && r.box.h > 0) pushPx("size.h", node.box.h, r.box.h);

  // --- Layout (only if PDS describes one) ---------------------------------
  if (node.layout) {
    const pdsFlow = node.layout.flow === "col" ? "column" : "row";
    const renFlow = styles.flexDirection;
    if (renFlow && renFlow !== pdsFlow) {
      deltas.push({
        el: node.el,
        name: node.name,
        kind: "layout.flow",
        expected: pdsFlow,
        actual: renFlow,
        severity: "error",
      });
    }
    if (node.layout.gap !== undefined) {
      const v = parsePx(styles.gap);
      if (v !== null) pushPx("layout.gap", node.layout.gap, v);
    }
    const pad = node.layout.pad;
    const sideMap: Array<[string, number, number | null]> = [
      ["pad.top", pad[0], parsePx(styles.paddingTop)],
      ["pad.right", pad[1], parsePx(styles.paddingRight)],
      ["pad.bottom", pad[2], parsePx(styles.paddingBottom)],
      ["pad.left", pad[3], parsePx(styles.paddingLeft)],
    ];
    for (const [kind, expected, actual] of sideMap) {
      if (actual !== null) pushPx(kind, expected, actual);
    }
    if (node.layout.justify) {
      const v = styles.justifyContent;
      if (v && v !== node.layout.justify) {
        deltas.push({
          el: node.el,
          name: node.name,
          kind: "layout.justify",
          expected: node.layout.justify,
          actual: v,
          severity: "warn",
        });
      }
    }
    if (node.layout.align) {
      const v = styles.alignItems;
      if (v && v !== node.layout.align) {
        deltas.push({
          el: node.el,
          name: node.name,
          kind: "layout.align",
          expected: node.layout.align,
          actual: v,
          severity: "warn",
        });
      }
    }
  }

  // --- Fill (background-color for non-text; text colour goes below) -------
  if (
    node.fill &&
    node.fill.startsWith("$c") &&
    node.type !== "text" &&
    styles.backgroundColor
  ) {
    pushColorDelta(
      node,
      "fill",
      tokens.color[node.fill],
      styles.backgroundColor,
      tol,
      deltas,
    );
  }

  // --- Form-control UA-style fallthrough (real-world bug #16) -------------
  // When rendered.backgroundColor parses to a UA keyword like `buttonface` or
  // `field`, the agent's reset CSS isn't taking and the browser is painting
  // the native control. This silently breaks dashboards built on <button>
  // elements with custom backgrounds. Surface it as a warn.
  if (styles.backgroundColor && isUserAgentColor(styles.backgroundColor)) {
    deltas.push({
      el: node.el,
      name: node.name,
      kind: "ua-style-fallthrough",
      expected: "explicit background-color",
      actual: styles.backgroundColor,
      severity: "warn",
    });
  }

  // --- Text content ------------------------------------------------------
  if (typeof node.chars === "string" && typeof r.text === "string") {
    const exp = node.chars.trim();
    const act = r.text.trim();
    if (exp !== act) {
      deltas.push({
        el: node.el,
        name: node.name,
        kind: "text.chars",
        expected: exp,
        actual: act,
        severity: "warn",
      });
    }
  }

  // --- Text colour (TEXT nodes use `color` in the browser) ---------------
  if (node.type === "text" && node.fill && node.fill.startsWith("$c") && styles.color) {
    pushColorDelta(node, "text.color", tokens.color[node.fill], styles.color, tol, deltas);
  }

  // --- Text decoration (real-world bug #14: missing strike-through on
  //     completed-checklist items) ----------------------------------------
  if (node.type === "text" && node.textDecoration) {
    const dec = (styles.textDecorationLine ?? styles.textDecoration ?? "").toLowerCase();
    if (!dec.includes(node.textDecoration)) {
      deltas.push({
        el: node.el,
        name: node.name,
        kind: "text.decoration",
        expected: node.textDecoration,
        actual: dec || "none",
        severity: "error",
      });
    }
  }

  // --- Text style (font weight / size / line-height / family) ------------
  if (node.text && node.text.startsWith("$t")) {
    const tk = tokens.text[node.text];
    const parsed = tk ? parseTextToken(tk) : null;
    if (parsed) {
      const renSize = parsePx(styles.fontSize);
      if (renSize !== null) pushPx("text.size", parsed.size, renSize, { ok: 0.5, warn: 1.5 });
      const renWeight = normalizeWeight(styles.fontWeight);
      if (renWeight !== null && renWeight !== parsed.weight) {
        const diff = Math.abs(renWeight - parsed.weight);
        deltas.push({
          el: node.el,
          name: node.name,
          kind: "text.weight",
          expected: parsed.weight,
          actual: renWeight,
          diff,
          severity: diff <= 100 ? "warn" : "error",
        });
      }
      if (parsed.lh) {
        const renRatio = computeLineHeightRatio(styles.lineHeight, renSize);
        if (renRatio !== null) {
          const diff = Math.abs(renRatio - parsed.lh);
          if (diff > 0.05) {
            deltas.push({
              el: node.el,
              name: node.name,
              kind: "text.lh",
              expected: parsed.lh,
              actual: Math.round(renRatio * 100) / 100,
              diff,
              severity: diff > 0.15 ? "error" : "warn",
            });
          }
        }
      }
      if (parsed.family && styles.fontFamily) {
        const ff = styles.fontFamily.toLowerCase();
        if (!ff.includes(parsed.family.toLowerCase())) {
          deltas.push({
            el: node.el,
            name: node.name,
            kind: "text.family",
            expected: parsed.family,
            actual: styles.fontFamily,
            severity: "warn",
          });
        }
      }
    }
  }

  // --- Border radius -----------------------------------------------------
  if (node.radius !== undefined && styles.borderRadius) {
    let expected: number | "full" | null = null;
    if (typeof node.radius === "string") expected = tokens.radius[node.radius] ?? null;
    else if (Array.isArray(node.radius)) expected = node.radius[0] ?? null;
    if (expected !== null) {
      const v = parsePx(styles.borderRadius);
      if (v !== null) {
        if (expected === "full") {
          const minSide = Math.min(node.box.w, node.box.h);
          // Anything >= half the smaller side is visually a pill/circle.
          if (minSide > 0 && v + tol.px.ok < minSide / 2) {
            deltas.push({
              el: node.el,
              name: node.name,
              kind: "radius",
              expected: `full (>= ${Math.round((minSide / 2) * 100) / 100}px)`,
              actual: v,
              severity: v + tol.px.warn < minSide / 2 ? "error" : "warn",
            });
          }
        } else {
          pushPx("radius", expected, v);
        }
      }
    }
  }

  // --- Stroke (border) ---------------------------------------------------
  if (node.stroke && node.stroke.startsWith("$c") && styles.borderColor) {
    pushColorDelta(node, "stroke", tokens.color[node.stroke], styles.borderColor, tol, deltas);
  }
  if (node.strokeW !== undefined && styles.borderWidth) {
    const v = parsePx(styles.borderWidth);
    if (v !== null) pushPx("stroke.width", node.strokeW, v);
  }

  // --- Opacity -----------------------------------------------------------
  if (typeof node.opacity === "number" && styles.opacity) {
    const v = parseFloat(styles.opacity);
    if (!Number.isNaN(v)) {
      const diff = Math.abs(node.opacity - v);
      if (diff > 0.05) {
        deltas.push({
          el: node.el,
          name: node.name,
          kind: "opacity",
          expected: node.opacity,
          actual: v,
          diff,
          severity: diff > 0.15 ? "error" : "warn",
        });
      }
    }
  }
}

function pushColorDelta(
  node: PdsNode,
  kind: string,
  expectedHex: string | undefined,
  renderedColor: string,
  tol: Tolerances,
  deltas: Delta[],
): void {
  if (!expectedHex) return;
  const exp = parseColor(expectedHex);
  const actual = parseColor(renderedColor);
  if (!exp || !actual) return;
  const diff = colorDistance(exp, actual);
  if (diff <= tol.color.ok) return;
  deltas.push({
    el: node.el,
    name: node.name,
    kind,
    expected: expectedHex,
    actual: rgbToHex(actual),
    diff,
    severity: diff > tol.color.warn ? "error" : "warn",
  });
}

/* ---------------------------------------------------------------------- */
/* Parsers — all return null on anything unrecognised                      */
/* ---------------------------------------------------------------------- */

interface Rgba {
  r: number;
  g: number;
  b: number;
  a: number;
}

export function parseColor(s: string | undefined): Rgba | null {
  if (!s) return null;
  const t = s.trim().toLowerCase();
  if (t === "" || t === "transparent" || t === "none" || t === "currentcolor") return null;

  const hexMatch = t.match(/^#([0-9a-f]+)$/);
  if (hexMatch && hexMatch[1]) {
    let hex = hexMatch[1];
    if (hex.length === 3 || hex.length === 4) {
      hex = hex
        .split("")
        .map((c) => c + c)
        .join("");
    }
    if (hex.length === 6 || hex.length === 8) {
      const r = parseInt(hex.slice(0, 2), 16);
      const g = parseInt(hex.slice(2, 4), 16);
      const b = parseInt(hex.slice(4, 6), 16);
      const a = hex.length === 8 ? parseInt(hex.slice(6, 8), 16) / 255 : 1;
      if (![r, g, b].some(Number.isNaN)) return { r, g, b, a };
    }
    return null;
  }

  const rgbMatch = t.match(/^rgba?\s*\(([^)]+)\)$/);
  if (rgbMatch && rgbMatch[1]) {
    const parts = rgbMatch[1].split(/[\s,/]+/).filter(Boolean);
    if (parts.length >= 3) {
      const r = Math.round(parseFloat(parts[0]!));
      const g = Math.round(parseFloat(parts[1]!));
      const b = Math.round(parseFloat(parts[2]!));
      const a = parts[3] !== undefined ? parseFloat(parts[3]) : 1;
      if (![r, g, b].some(Number.isNaN)) {
        return { r, g, b, a: Number.isNaN(a) ? 1 : a };
      }
    }
  }
  return null;
}

function colorDistance(a: Rgba, b: Rgba): number {
  return Math.abs(a.r - b.r) + Math.abs(a.g - b.g) + Math.abs(a.b - b.b);
}

function rgbToHex(c: Rgba): string {
  const ch = (n: number): string =>
    Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, "0");
  const base = `#${ch(c.r)}${ch(c.g)}${ch(c.b)}`;
  return c.a >= 1 ? base : base + ch(c.a * 255);
}

export function parsePx(s: string | undefined): number | null {
  if (s === undefined || s === null) return null;
  const t = s.trim();
  if (t === "0") return 0;
  if (t === "" || t === "auto" || t === "normal") return null;
  const m = t.match(/^(-?\d+(?:\.\d+)?)\s*px$/i);
  if (m && m[1]) return parseFloat(m[1]);
  const n = parseFloat(t);
  return Number.isFinite(n) ? n : null;
}

export function parseTextToken(
  s: string,
): { weight: number; size: number; lh?: number; family?: string } | null {
  const m = s.trim().match(
    /^(\d+)\s+(\d+(?:\.\d+)?)px(?:\s*\/\s*(\d+(?:\.\d+)?))?\s*(.*)$/,
  );
  if (!m || !m[1] || !m[2]) return null;
  const family = m[4] && m[4].trim() ? m[4].trim() : undefined;
  return {
    weight: parseInt(m[1], 10),
    size: parseFloat(m[2]),
    lh: m[3] ? parseFloat(m[3]) : undefined,
    family,
  };
}

function normalizeWeight(s: string | undefined): number | null {
  if (!s) return null;
  if (/^\d+$/.test(s)) return parseInt(s, 10);
  const map: Record<string, number> = {
    normal: 400,
    bold: 700,
    lighter: 300,
    bolder: 800,
  };
  return map[s.toLowerCase()] ?? null;
}

function computeLineHeightRatio(
  lh: string | undefined,
  size: number | null,
): number | null {
  if (!lh) return null;
  const lhPx = parsePx(lh);
  if (lhPx !== null && size !== null && size > 0) return lhPx / size;
  const n = parseFloat(lh);
  if (Number.isFinite(n) && !lh.includes("px") && !lh.includes("%")) return n;
  return null;
}

function severityRank(s: Severity): number {
  return s === "error" ? 0 : s === "warn" ? 1 : 2;
}

const UA_COLOR_KEYWORDS = new Set([
  "buttonface",
  "buttontext",
  "field",
  "fieldtext",
  "highlight",
  "highlighttext",
  "graytext",
  "menu",
  "menutext",
  "window",
  "windowframe",
  "windowtext",
  "linktext",
  "visitedtext",
  "activetext",
  "activeborder",
  "inactiveborder",
  "infobackground",
  "infotext",
  "scrollbar",
  "threeddarkshadow",
  "threedface",
  "threedhighlight",
  "threedlightshadow",
  "threedshadow",
]);

/**
 * True when a CSS color value is a user-agent system keyword. Chrome computes
 * `<button>` and `<input>` backgrounds to these when the page's CSS reset
 * fails to override — the symptom of the real-world dashboard-pill
 * regression that motivated check #16.
 */
function isUserAgentColor(s: string): boolean {
  if (!s) return false;
  return UA_COLOR_KEYWORDS.has(s.trim().toLowerCase());
}
