/**
 * plumb_verify's comparison engine (plan §8).
 *
 * Pure: given a PDS and the agent's rendered layout, produce a sorted list of
 * structured deltas (no CV, no pixel diff). Every comparison is tolerance-aware
 * and edge-case-careful.
 */
import { resolveLayout } from "./normalize/resolve";
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
  // v0.10 Phase 6 — colour distance is ΔE2000 (perceptually uniform). Thresholds:
  //   ≤ ok (1.0) → just-noticeable, never flag
  //   ≤ warn (3.5) → clearly different but plausibly within an agent's tolerance
  //   > warn → likely a real mismatch
  // Previously this was sum-of-abs-RGB-channel-deltas (ok=6, warn=24); the new
  // numbers are smaller because ΔE2000 is a different scale.
  color: { ok: 1, warn: 3.5 },
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
  /**
   * Count of reachable nodes that carry real visual signal (text, fill,
   * effect, image, radius, icon — see {@link isImportantNode}). Skeleton
   * frames are excluded. The denominator the fit score uses so "I built
   * every node that matters" can reach 100% without tagging spacer frames.
   */
  importantTotal: number;
  /** How many of those important nodes were actually tagged/built. */
  importantMatched: number;
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
  let importantTotal = 0;
  let importantMatched = 0;
  for (const el of reachable) {
    const node = pds.nodes[el];
    if (!node) continue;
    const important = isImportantNode(node);
    if (important) importantTotal += 1;
    if (matchedEls.has(el)) {
      if (important) importantMatched += 1;
      continue;
    }
    if (important) importantUntagged.push(el);
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
    importantTotal,
    importantMatched,
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
  // Layout may arrive as a `$lN` ref into tokens.layout (v0.10+) — resolve
  // once and use the literal everywhere below.
  const layout = resolveLayout(node.layout, tokens);
  if (layout) {
    const pdsFlow = layout.flow === "col" ? "column" : "row";
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
    if (layout.gap !== undefined) {
      const v = parsePx(styles.gap);
      if (v !== null) pushPx("layout.gap", layout.gap, v);
    }
    const pad = layout.pad;
    const sideMap: Array<[string, number, number | null]> = [
      ["pad.top", pad[0], parsePx(styles.paddingTop)],
      ["pad.right", pad[1], parsePx(styles.paddingRight)],
      ["pad.bottom", pad[2], parsePx(styles.paddingBottom)],
      ["pad.left", pad[3], parsePx(styles.paddingLeft)],
    ];
    for (const [kind, expected, actual] of sideMap) {
      if (actual !== null) pushPx(kind, expected, actual);
    }
    if (layout.justify) {
      const v = styles.justifyContent;
      if (v && v !== layout.justify) {
        deltas.push({
          el: node.el,
          name: node.name,
          kind: "layout.justify",
          expected: layout.justify,
          actual: v,
          severity: "warn",
        });
      }
    }
    if (layout.align) {
      const v = styles.alignItems;
      if (v && v !== layout.align) {
        deltas.push({
          el: node.el,
          name: node.name,
          kind: "layout.align",
          expected: layout.align,
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

  // --- v0.10 Phase 6 — shadow / rotation / flex-child / fill-stack -------

  // Shadow: compare resolved CSS string or just confirm the renderer set
  // a non-empty box-shadow. We deliberately don't byte-compare — small
  // colour/blur rounding shouldn't flag — but missing it entirely is a real bug.
  const expectedShadow =
    typeof node.shadow === "string" && node.shadow.startsWith("$s")
      ? tokens.shadow[node.shadow]
      : node.shadow;
  if (expectedShadow && (!styles.boxShadow || styles.boxShadow === "none")) {
    deltas.push({
      el: node.el,
      name: node.name,
      kind: "shadow.missing",
      expected: expectedShadow,
      actual: styles.boxShadow ?? "(unset)",
      severity: "error",
    });
  }

  // Rotation: parse `transform: rotate(Ndeg)` or a 2D matrix. Allow ±0.5°
  // slack so subpixel rounding doesn't fire.
  if (typeof node.rotation === "number" && Math.abs(node.rotation) > 0.5) {
    const renderedDeg = parseRotation(styles.transform);
    if (renderedDeg !== null) {
      const diff = Math.abs(node.rotation - renderedDeg);
      if (diff > 1) {
        deltas.push({
          el: node.el,
          name: node.name,
          kind: "rotation",
          expected: round(node.rotation, 2),
          actual: round(renderedDeg, 2),
          diff,
          severity: diff > 5 ? "error" : "warn",
        });
      }
    }
  }

  // Flex-child sizing — grow + align-self. Misses here are the #1
  // "almost right" layout bug from real screens.
  if (typeof node.grow === "number" && node.grow > 0 && styles.flexGrow) {
    const v = parseFloat(styles.flexGrow);
    if (!Number.isNaN(v) && Math.abs(v - node.grow) > 0.01) {
      deltas.push({
        el: node.el,
        name: node.name,
        kind: "flex.grow",
        expected: node.grow,
        actual: v,
        diff: Math.abs(v - node.grow),
        severity: "warn",
      });
    }
  }
  if (node.selfAlign && styles.alignSelf && styles.alignSelf !== "auto") {
    const cssAlign =
      node.selfAlign === "stretch"
        ? "stretch"
        : node.selfAlign === "min"
          ? "flex-start"
          : node.selfAlign === "max"
            ? "flex-end"
            : node.selfAlign === "center"
              ? "center"
              : undefined;
    if (cssAlign && cssAlign !== styles.alignSelf) {
      deltas.push({
        el: node.el,
        name: node.name,
        kind: "flex.selfAlign",
        expected: cssAlign,
        actual: styles.alignSelf,
        severity: "warn",
      });
    }
  }

  // Fill-stack count — when PDS says "this surface has 3 layered fills"
  // a flat `background-color` rendered alone is a clear miss. Resolve the
  // fills ref (may be a $fN token) before counting.
  const fillsValue =
    typeof node.fills === "string"
      ? (tokens as TokenTable).fills?.[node.fills]
      : node.fills;
  if (Array.isArray(fillsValue) && fillsValue.length > 1) {
    const bg = styles.backgroundImage ?? "";
    // Count comma-separated layers in background-image. A single solid
    // colour shows up as just `background-color` with no `background-image`.
    const layers = bg && bg !== "none" ? bg.split(/,\s*(?![^()]*\))/).length : 0;
    if (layers < fillsValue.length) {
      deltas.push({
        el: node.el,
        name: node.name,
        kind: "fills.count",
        expected: fillsValue.length,
        actual: layers,
        diff: fillsValue.length - layers,
        severity: "warn",
      });
    }
  }
}

/**
 * Pull a Z rotation in degrees out of a CSS `transform` string. Handles
 * the common `rotate(45deg)` and the 2D `matrix(a,b,c,d,...)` form.
 * Returns null on `none`, 3D matrices, and anything we don't recognise.
 */
function parseRotation(transform: string | undefined): number | null {
  if (!transform || transform === "none") return null;
  const rot = transform.match(/rotate(?:Z)?\(\s*(-?\d+(?:\.\d+)?)deg\s*\)/);
  if (rot && rot[1]) return Number(rot[1]);
  const m2 = transform.match(/^matrix\(\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)/);
  if (m2 && m2[1] && m2[2]) {
    const a = Number(m2[1]);
    const b = Number(m2[2]);
    return (Math.atan2(b, a) * 180) / Math.PI;
  }
  return null;
}

function round(n: number, places: number): number {
  const p = Math.pow(10, places);
  return Math.round(n * p) / p;
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

/**
 * Perceptually-uniform colour distance. Replaces the v0.9 RGB-Manhattan
 * metric, which scored "8 units off in each channel" the same as
 * "24 units off in one channel" even though the former is barely visible
 * and the latter is glaring. ΔE2000 fixes both halves of that bug.
 *
 * Implementation: sRGB → linear → XYZ (D65) → Lab → ΔE2000. Numbers
 * track the CIE 2000 colour-difference formula exactly enough for the
 * 0..10 range agents see in practice; no parametric weighting (kL=kC=kH=1).
 */
function colorDistance(a: Rgba, b: Rgba): number {
  const la = rgbaToLab(a);
  const lb = rgbaToLab(b);
  return deltaE2000(la, lb);
}

interface Lab {
  l: number;
  a: number;
  b: number;
}

function srgbToLinear(c: number): number {
  const x = c / 255;
  return x <= 0.04045 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
}

function rgbaToLab({ r, g, b }: Rgba): Lab {
  const R = srgbToLinear(r);
  const G = srgbToLinear(g);
  const B = srgbToLinear(b);
  // sRGB → XYZ (D65) per IEC 61966-2-1.
  const X = R * 0.4124564 + G * 0.3575761 + B * 0.1804375;
  const Y = R * 0.2126729 + G * 0.7151522 + B * 0.072175;
  const Z = R * 0.0193339 + G * 0.119192 + B * 0.9503041;
  // XYZ → Lab (D65 reference white).
  const Xn = 0.95047;
  const Yn = 1.0;
  const Zn = 1.08883;
  const f = (t: number): number => (t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27) * t / 116 + 16 / 116);
  const fx = f(X / Xn);
  const fy = f(Y / Yn);
  const fz = f(Z / Zn);
  return { l: 116 * fy - 16, a: 500 * (fx - fy), b: 200 * (fy - fz) };
}

function deltaE2000(la: Lab, lb: Lab): number {
  const deg = (rad: number): number => (rad * 180) / Math.PI;
  const rad = (d: number): number => (d * Math.PI) / 180;

  const Lbar = (la.l + lb.l) / 2;
  const C1 = Math.hypot(la.a, la.b);
  const C2 = Math.hypot(lb.a, lb.b);
  const Cbar = (C1 + C2) / 2;
  const G = 0.5 * (1 - Math.sqrt(Math.pow(Cbar, 7) / (Math.pow(Cbar, 7) + Math.pow(25, 7))));
  const a1 = la.a * (1 + G);
  const a2 = lb.a * (1 + G);
  const C1p = Math.hypot(a1, la.b);
  const C2p = Math.hypot(a2, lb.b);
  const Cpbar = (C1p + C2p) / 2;
  const h1 = Math.atan2(la.b, a1);
  const h2 = Math.atan2(lb.b, a2);
  const h1d = ((deg(h1) % 360) + 360) % 360;
  const h2d = ((deg(h2) % 360) + 360) % 360;

  let dhp = h2d - h1d;
  if (Math.abs(dhp) > 180) dhp += dhp > 0 ? -360 : 360;
  const dLp = lb.l - la.l;
  const dCp = C2p - C1p;
  const dHp = 2 * Math.sqrt(C1p * C2p) * Math.sin(rad(dhp / 2));

  let Hpbar = h1d + h2d;
  if (Math.abs(h1d - h2d) > 180) Hpbar += Hpbar < 360 ? 360 : -360;
  Hpbar /= 2;

  const T =
    1 -
    0.17 * Math.cos(rad(Hpbar - 30)) +
    0.24 * Math.cos(rad(2 * Hpbar)) +
    0.32 * Math.cos(rad(3 * Hpbar + 6)) -
    0.2 * Math.cos(rad(4 * Hpbar - 63));
  const SL = 1 + (0.015 * Math.pow(Lbar - 50, 2)) / Math.sqrt(20 + Math.pow(Lbar - 50, 2));
  const SC = 1 + 0.045 * Cpbar;
  const SH = 1 + 0.015 * Cpbar * T;
  const dTheta = 30 * Math.exp(-Math.pow((Hpbar - 275) / 25, 2));
  const RC = 2 * Math.sqrt(Math.pow(Cpbar, 7) / (Math.pow(Cpbar, 7) + Math.pow(25, 7)));
  const RT = -RC * Math.sin(2 * rad(dTheta));

  return Math.sqrt(
    Math.pow(dLp / SL, 2) +
      Math.pow(dCp / SC, 2) +
      Math.pow(dHp / SH, 2) +
      RT * (dCp / SC) * (dHp / SH),
  );
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
