/**
 * The Semantic Graph — Plumb's Canonical Intermediate Representation (CIR).
 * See docs/ROADMAP-v0.14-design-intelligence.md §5 for the design rationale.
 *
 * This is the platform-agnostic knowledge model Plumb reasons over. It is
 * built FROM a Source Graph (today, a `PdsDocument` produced by
 * `src/normalize/normalize.ts`) and is the only thing enrichers are allowed
 * to read — an enricher never imports Figma types or PDS internals.
 *
 * `style` is deliberately NOT a general "every visual property" bag. It
 * carries only the resolved facets an enricher actually consumes today
 * (`layout`, `textPx`, `isSurface`). Grow it when a real enricher needs a
 * new facet — never speculatively. Same discipline for `CirEdgeKind`:
 * `references` and `flowsTo` are part of the contract (so a future
 * enricher or adapter can rely on the shape existing) but nothing populates
 * them yet — no enricher needs token-reference or prototype-flow edges
 * until diff/flow work lands.
 */
import type { Effect, Fill, PdsLayout } from "../pds";

export type NodeKind = "container" | "text" | "vector" | "image" | "componentInstance";

export interface CirNodeStyle {
  /** Resolved (ref-followed) auto-layout config — undefined when the node has none. */
  layout?: PdsLayout;
  /** Resolved font size in px — text nodes only. */
  textPx?: number;
  /** Has a radius, a shadow/blur effect, or a fill+stroke pair — reads as a
   *  bounded, styled "surface" rather than a bare layout container. */
  isSurface?: boolean;
  /** Resolved solid color (`#rrggbb` or `#rrggbbaa`), own fill only — no
   *  ancestor-inheritance walk. Undefined for multi-layer fill stacks,
   *  gradients, images, or nodes with no fill at all; a consumer that needs
   *  "what's behind this node" (e.g. AccessibilityEnricher's contrast
   *  check) walks the graph itself via `children`, exactly like
   *  RoleEnricher's own tree walks — that's a derived, check-specific
   *  concern, not a general CIR fact worth carrying on every node.
   *  `fillColor` stays the "compact single dominant color" convenience
   *  field, mirroring `PdsNode.fill`/`.fills`'s own compact/full split —
   *  `fills` below is the lossless form (gradients, multi-layer stacks). */
  fillColor?: string;
  /** Full fill stack — set whenever the compact `fillColor` would be lossy
   *  (a gradient, more than one layer). Reuses `PdsNode`'s own `Fill` type
   *  (`SolidFill | GradientFill | ImageFill`) rather than inventing a
   *  parallel shape — it was already CSS-value-shaped (hex colors, stop
   *  positions), not Figma-specific. v0.14 M9.1: populated by the HTML
   *  adapter; the Figma adapter still surfaces fills via `PdsNode.fills`
   *  directly rather than through this facet — noted as a real, not yet
   *  closed, parity gap, not silently glossed over. */
  fills?: Fill[];
  /** Full effect stack (shadows, blur) — same reuse of `PdsNode`'s `Effect`
   *  type, same HTML-adapter-only parity note as `fills` above. */
  effects?: Effect[];
  /** CSS `backdrop-filter` shorthand (e.g. `"blur(24px)"`) — mirrors
   *  `PdsNode.backdropFilter`. */
  backdropFilter?: string;
  /** 0..1, omitted at 1 (mirrors `PdsNode.opacity`'s own "omit at default"
   *  convention). */
  opacity?: number;
  /** `text-align` — text nodes only. */
  textAlign?: string;
  /** `underline` or `line-through` — text nodes only, mirrors
   *  `PdsNode.textDecoration`. */
  textDecoration?: "underline" | "line-through";
  /** CSS px. */
  letterSpacing?: number;
  /** CSS px (already resolved from a possibly-unitless/percentage
   *  `line-height` by the capture step — see `buildFromHtml.ts`). */
  lineHeightPx?: number;
  /** CSS `position` — `static` (the default, never emitted) /
   *  `relative` / `absolute` / `fixed` / `sticky`. A `fixed`/`sticky` node
   *  is viewport-pinned, not part of normal document flow — a consumer
   *  reasoning about "what's the next section down the page" (the way
   *  `RoleEnricher`'s free-canvas ordering fallback does) should treat one
   *  differently, though no enricher does yet; this facet exists so that's
   *  possible without another adapter round-trip. Not wired into
   *  `RoleEnricher` itself — that would leak an HTML-specific concept into
   *  Figma-shared code. */
  position?: "relative" | "absolute" | "fixed" | "sticky";
}

export interface CirNode {
  id: string;
  kind: NodeKind;
  box: { w: number; h: number };
  pos?: { x: number; y: number };
  children: string[];
  /** Text content — text nodes only, dominant run only (no per-run detail;
   *  add if an enricher needs mixed-style runs). */
  chars?: string;
  style: CirNodeStyle;
  /** The only adapter-leaking field. Nothing except "open in the source
   *  tool" tooling should ever read this — enrichers and projections must
   *  not branch on `sourceRef.adapter`. `"html"` added in v0.14 M9
   *  (`src/semantic/buildFromHtml.ts`) — the first real second value here,
   *  proving this was a union from day one and not just a `"figma"` literal
   *  with delusions of extensibility. */
  sourceRef: { adapter: "figma" | "html"; nativeId: string };
}

export type CirEdgeKind =
  | "contains" // parent → child. Redundant with CirNode.children; kept for
  // graph-shaped queries (e.g. "everything that flows into X").
  | "references" // node → token. Not populated yet — see file docstring.
  | "instanceOf" // component instance → component definition id.
  | "repeats" // repeat-group parent → template node (the template itself
  // stays a real CirNode; compressed sibling instances are not
  // materialized as nodes, matching PDS's existing lossy-by-design
  // repeat compression).
  | "flowsTo"; // prototype navigation. Not populated yet — see file docstring.

export interface CirEdge {
  from: string;
  to: string;
  kind: CirEdgeKind;
  meta?: Record<string, unknown>;
}

export interface CirAnnotation<T = unknown> {
  nodeId: string;
  /** Never a shared field on the node — this is the fix for PdsNode.pattern
   *  becoming a dumping ground for every enricher's output. */
  namespace: string;
  /** The producing enricher's version, so a projection can tell which
   *  revision of a heuristic produced a given label. */
  version: string;
  value: T;
}

export interface SemanticGraph {
  cirVersion: string;
  root: string;
  nodes: Record<string, CirNode>;
  edges: CirEdge[];
}
