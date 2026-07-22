/**
 * HTML Source Graph → Semantic Graph. The HTML analog of `build.ts` (which
 * does the same job for a Figma-sourced `PdsDocument`) — same job, same
 * "only place source-shaped knowledge is allowed to leak into the semantic
 * layer" role (`build.ts`'s own docstring), different source shape.
 *
 * This is the concrete test of §5's claim that a new adapter is additive:
 * every enricher (`RoleEnricher`, `AccessibilityEnricher`) reads only
 * `CirNode`/`CirEdge`/`SemanticGraph` and has zero Figma-specific
 * assumptions baked in, so nothing downstream needed to change for this
 * file to exist.
 *
 * Honest scope note: `RoleEnricher`'s `nav`/`hero`/`footer`/`sidebar`
 * detection works unmodified on an HTML-sourced graph — those rules only
 * read `box`/`pos`/`style.layout`/`style.textPx`/`children`, all populated
 * here. `card` detection does NOT, yet: it keys off `repeats` edges, which
 * come from Figma's plugin-side repeat-group detection (`PdsRepeatGroup`)
 * — this mapper doesn't run an equivalent structural-similarity pass over
 * HTML siblings. That's a real, scoped gap, not a silent one: card
 * detection on an imported webpage needs its own similarity detector,
 * deferred rather than faked here.
 */
import { parseColor } from "../verify";
import { parseBoxShadow, parseGradient } from "../sources/html/cssParse";
import type { CirEdge, CirNode, CirNodeStyle, NodeKind, SemanticGraph } from "./graph";
import type { HtmlSourceNode, HtmlStyle } from "../sources/html/sourceGraph";
import type { PdsLayout } from "../pds";

const POSITIONS = new Set(["relative", "absolute", "fixed", "sticky"]);

const CIR_VERSION = "1.0.0";
const FLEX_JUSTIFY_DEFAULT = new Set(["normal", "flex-start", "start"]);
const FLEX_ALIGN_DEFAULT = new Set(["normal", "flex-start", "start", "stretch"]);

function toHex(rgb: { r: number; g: number; b: number; a: number }): string {
  const ch = (n: number) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, "0");
  const hex = `#${ch(rgb.r)}${ch(rgb.g)}${ch(rgb.b)}`;
  return rgb.a < 1 ? `${hex}${ch(rgb.a * 255)}` : hex;
}

function resolveColor(css: string | undefined): string | undefined {
  if (!css) return undefined;
  const rgba = parseColor(css);
  if (!rgba) return undefined;
  if (rgba.a === 0) return undefined; // fully transparent isn't "a color"
  return toHex(rgba);
}

function px(value: string | undefined): number {
  if (!value) return 0;
  const n = parseFloat(value);
  return Number.isNaN(n) ? 0 : n;
}

function kindOf(node: HtmlSourceNode): NodeKind {
  // svg BEFORE isImage — a real bug found live against vercel.com, not
  // caught by the unit test that covered this ordering: captureFn.ts's own
  // `isImage` check includes `tag === "svg"` (a bare <svg> element sets
  // `isImage: true`), so checking `isImage` first meant every real inline
  // SVG (icons, logos — inline vector markup, never a `src` URL to begin
  // with) got classified "image" and warned "no captured src" instead of
  // correctly reading as "vector." The hand-built test fixture for this
  // case set `isImage: false` on its svg node, which doesn't match what
  // real captured data actually looks like — exactly the kind of gap a
  // fixture that doesn't mirror the real capture shape hides.
  if (node.tag === "svg") return "vector";
  if (node.isImage) return "image";
  if (node.children.length === 0 && node.text) return "text";
  return "container";
}

/** `display:flex` → `PdsLayout`. `PdsLayout` was already CSS-shaped before
 *  this adapter existed (`normalize/layout.ts`'s `toLayout()`: "Auto-layout
 *  → flexbox... the single source of truth") — `justify-content` values
 *  pass through unchanged, no Figma-enum translation needed. Grid and other
 *  non-flex layout modes aren't mapped to a layout object (their children
 *  keep DOM-order + real `pos`, which the section/sidebar heuristics can
 *  still reason about via the free-canvas fallback path). */
function layoutOf(style: HtmlStyle): PdsLayout | undefined {
  if (style.display !== "flex" && style.display !== "inline-flex") return undefined;
  const flow = style.flexDirection === "column" || style.flexDirection === "column-reverse" ? "col" : "row";
  const layout: PdsLayout = {
    flow,
    pad: [px(style.paddingTop), px(style.paddingRight), px(style.paddingBottom), px(style.paddingLeft)],
  };
  const gap = px(style.gap);
  if (gap) layout.gap = gap;
  if (style.justifyContent && !FLEX_JUSTIFY_DEFAULT.has(style.justifyContent)) layout.justify = style.justifyContent;
  if (style.alignItems && !FLEX_ALIGN_DEFAULT.has(style.alignItems)) layout.align = style.alignItems;
  if (style.flexWrap === "wrap" || style.flexWrap === "wrap-reverse") layout.wrap = true;
  return layout;
}

/** Radius, shadow, or a background + border pair — same "styled surface"
 *  bar `build.ts`'s Figma-sourced `isSurface` uses. */
function isSurface(node: HtmlSourceNode): boolean {
  const s = node.style;
  const hasRadius = !!s.borderRadius && px(s.borderRadius) > 0;
  const hasShadow = !!s.boxShadow && s.boxShadow !== "none";
  const hasBorderedFill = !!resolveColor(s.backgroundColor) && !!s.borderWidth && px(s.borderWidth) > 0;
  return hasRadius || hasShadow || hasBorderedFill;
}

/** A `%`-based radius (`border-radius: 50%` — the standard CSS way to make
 *  a circle/pill) maps to Figma's `"full"` sentinel; a px value passes
 *  through as a number. */
function borderRadiusOf(css: string | undefined): number | "full" | undefined {
  if (!css) return undefined;
  if (css.includes("%")) return parseFloat(css) > 0 ? "full" : undefined;
  const n = px(css);
  return n > 0 ? n : undefined;
}

const TEXT_DECORATIONS = new Set(["underline", "line-through"]);

function styleOf(node: HtmlSourceNode, kind: NodeKind): CirNodeStyle {
  const s = node.style;
  const style: CirNodeStyle = {};
  const layout = layoutOf(s);
  if (layout) style.layout = layout;
  if (kind === "text") {
    const size = px(s.fontSize);
    if (size) style.textPx = size;
  }
  if (isSurface(node)) style.isSurface = true;

  // Fill: a gradient background wins over the compact solid `fillColor` —
  // same "compact form only when it isn't lossy" rule PDS's own fill/fills
  // split already follows. Text nodes never check backgroundImage (a
  // gradient text fill via background-clip:text is real CSS but a
  // sufficiently rare case not worth detecting here).
  if (kind !== "text" && s.backgroundImage) {
    const gradient = parseGradient(s.backgroundImage);
    if (gradient) style.fills = [gradient];
  }
  if (!style.fills) {
    const fillColor = resolveColor(kind === "text" ? s.color : s.backgroundColor);
    if (fillColor) style.fillColor = fillColor;
  }

  if (s.boxShadow) {
    const effects = parseBoxShadow(s.boxShadow);
    if (effects.length) style.effects = effects;
  }
  if (s.backdropFilter && s.backdropFilter !== "none") style.backdropFilter = s.backdropFilter;

  const opacity = s.opacity !== undefined ? parseFloat(s.opacity) : NaN;
  if (!Number.isNaN(opacity) && opacity < 1) style.opacity = Math.round(opacity * 100) / 100;

  if (kind === "text") {
    if (s.textAlign && s.textAlign !== "start" && s.textAlign !== "left") style.textAlign = s.textAlign;
    const decoration = (s.textDecorationLine ?? "").split(/\s+/).find((d) => TEXT_DECORATIONS.has(d));
    if (decoration) style.textDecoration = decoration as "underline" | "line-through";
    const letterSpacing = px(s.letterSpacing);
    if (letterSpacing) style.letterSpacing = letterSpacing;
    const lineHeightPx = px(s.lineHeight);
    if (lineHeightPx) style.lineHeightPx = lineHeightPx;
  }

  if (s.position && POSITIONS.has(s.position)) style.position = s.position as CirNodeStyle["position"];

  const borderRadius = borderRadiusOf(s.borderRadius);
  if (borderRadius !== undefined) style.borderRadius = borderRadius;
  const borderWidth = px(s.borderWidth);
  if (borderWidth > 0) {
    style.borderWidth = borderWidth;
    const borderColor = resolveColor(s.borderColor);
    if (borderColor) style.borderColor = borderColor;
  }

  return style;
}

export function buildSemanticGraphFromHtml(root: HtmlSourceNode): SemanticGraph {
  const nodes: Record<string, CirNode> = {};
  const edges: CirEdge[] = [];

  // Iterative (explicit stack), not recursive — `maxNodes` at capture time
  // (src/sources/html/capture.ts) bounds total node COUNT, not nesting
  // DEPTH: a narrow, deeply-nested live page (framework wrapper-div soup)
  // could still recurse arbitrarily deep. This is the least-trusted input
  // source in the tool surface (`plumb_import_web` is `openWorldHint: true`),
  // so it must degrade to "just runs a while," never a stack-overflow crash.
  const stack: { node: HtmlSourceNode; parentAbsPos: { x: number; y: number } | undefined }[] = [
    { node: root, parentAbsPos: undefined },
  ];
  while (stack.length > 0) {
    const { node, parentAbsPos } = stack.pop()!;
    const kind = kindOf(node);
    const pos = parentAbsPos ? { x: node.pos.x - parentAbsPos.x, y: node.pos.y - parentAbsPos.y } : undefined;
    const children = node.children.map((c) => c.id);

    nodes[node.id] = {
      id: node.id,
      kind,
      box: node.box,
      pos,
      children,
      chars: kind === "text" ? node.text : undefined,
      imageSrc: kind === "image" ? node.imageSrc : undefined,
      style: styleOf(node, kind),
      sourceRef: { adapter: "html", nativeId: node.id },
    };

    for (const child of node.children) edges.push({ from: node.id, to: child.id, kind: "contains" });
    for (let i = node.children.length - 1; i >= 0; i--) {
      stack.push({ node: node.children[i]!, parentAbsPos: node.pos });
    }
  }

  return { cirVersion: CIR_VERSION, root: resolveEffectiveRoot(root.id, nodes), nodes, edges };
}

/**
 * Descends through "transparent" single-child wrapper chains to find the
 * real content root — the concrete fix for a real finding from live-testing
 * this against actual sites, not a hypothetical: `document.body` on
 * essentially every React/Next.js/Vue/Svelte/Angular app has exactly ONE
 * child (the framework's root mount div), so `RoleEnricher`'s
 * `classifySections` — which only reasons about the GIVEN root's direct
 * children, and needs ≥2 of them to compare "first/candidate/last" — would
 * silently classify nothing on almost every real modern website if the
 * graph's `root` stayed pinned to literal `<body>`.
 *
 * All nodes, including the skipped wrapper ancestors, remain in the
 * returned graph's `nodes` map — only the `root` pointer (which section-
 * classification anchors on) moves. Stops at the first node with 0 or ≥2
 * children, or a non-container kind, so a page that genuinely has multiple
 * top-level siblings under `<body>` (a cookie-banner div alongside the
 * app's root div, say) is left exactly where it was.
 */
function resolveEffectiveRoot(startId: string, nodes: Record<string, CirNode>): string {
  let currentId = startId;
  for (;;) {
    const current = nodes[currentId];
    if (!current || current.kind !== "container" || current.children.length !== 1) return currentId;
    const onlyChild = current.children[0];
    if (!onlyChild || !nodes[onlyChild]) return currentId;
    currentId = onlyChild;
  }
}
