/**
 * The Plumb Design Spec (PDS) — a normalized, deduplicated, CSS-shaped
 * representation of a Figma subtree, built for an LLM to read cheaply and
 * implement correctly. See plan §5.
 */

export type Flow = "row" | "col";

export interface PdsLayout {
  /** flex-direction */
  flow: Flow;
  /** itemSpacing → gap */
  gap?: number;
  /** counterAxisSpacing on a wrapping container */
  gapCross?: number;
  /** [top, right, bottom, left] */
  pad: [number, number, number, number];
  /** justify-content, omitted when default (flex-start) */
  justify?: string;
  /** align-items, omitted when default (flex-start) */
  align?: string;
  /** flex-wrap */
  wrap?: boolean;
  /**
   * Main-axis content size: sum(children main-axis box) + (n-1)*gap.
   * Emitted only when `justify` is set AND the result is meaningfully
   * smaller than the container's main-axis box — i.e. the cases where a
   * renderer's naive "stack from start" assumption would mis-place items.
   * Compare to box.{w|h} minus matching `pad` ends to find the slack.
   */
  contentMain?: number;
}

/** A single colour stop inside a gradient fill. `at` is 0..1. */
export interface GradientStop {
  at: number;
  /** Hex with optional alpha, e.g. "#ff0066" or "#ff006680". */
  color: string;
}

export type GradientKind =
  | "linear-gradient"
  | "radial-gradient"
  | "angular-gradient"
  | "diamond-gradient";

/** Solid colour, with its own alpha. */
export interface SolidFill {
  type: "color";
  color: string;
  /** Layer-level opacity multiplier (0..1). Distinct from `color`'s alpha. */
  opacity?: number;
}

/** Linear / radial / angular gradient with full stop data — no info loss. */
export interface GradientFill {
  type: GradientKind;
  /** CSS-style angle in degrees, only meaningful for linear gradients. */
  angle?: number;
  stops: GradientStop[];
  opacity?: number;
}

/** Image paint. `assetId` matches the id you'd pass to plumb_assets. */
export interface ImageFill {
  type: "image";
  /** Plumb asset id (Figma node id). Use to tag `data-plumb-asset="<id>"`. */
  assetId?: string;
  /** Figma's CSS-equivalent scale mode. */
  scaleMode?: "fill" | "fit" | "stretch" | "crop" | "tile";
  opacity?: number;
}

export type Fill = SolidFill | GradientFill | ImageFill;

/** Drop or inset CSS shadow. */
export interface ShadowEffect {
  type: "drop-shadow" | "inner-shadow";
  x: number;
  y: number;
  blur: number;
  spread: number;
  color: string;
}

/**
 * Blur effect. `layer-blur` blurs the node itself (CSS `filter: blur()`);
 * `background-blur` blurs the content behind the node (CSS
 * `backdrop-filter: blur()` — that's what makes "frosted glass" panels look
 * the way they do).
 */
export interface BlurEffect {
  type: "layer-blur" | "background-blur";
  radius: number;
}

export type Effect = ShadowEffect | BlurEffect;

/**
 * A prototype transition wired in Figma. Surfaces what the design intends to
 * happen, not what the rendered DOM is doing — pair with CDP Animation
 * inspection if you need runtime verification.
 */
export interface MotionSpec {
  /** ON_CLICK, ON_HOVER, AFTER_TIMEOUT, MOUSE_DOWN, MOUSE_UP, … */
  trigger: string;
  /** SMART_ANIMATE, DISSOLVE, MOVE_IN, PUSH, INSTANT, … */
  kind: string;
  /** Milliseconds. */
  duration?: number;
  /** CSS-shaped easing — `ease-out`, `linear`, or a `cubic-bezier(...)` literal. */
  easing?: string;
  /** Destination node id, when the action is a NODE transition. */
  target?: string;
}

export interface PdsNode {
  /** Raw Figma node id — stable across edits. */
  id: string;
  /** Stable, human-readable handle. The agent tags rendered DOM `data-plumb-id="<el>"`. */
  el: string;
  /**
   * Globally-unique dotted path from the requested root to this node, e.g.
   * `applayout.main-content.dashboard.button.container-2`. Use this when
   * tagging deeply-nested DOM where `el` alone might collide across reused
   * subtrees; `plumb_verify` accepts either as the join key.
   */
  path?: string;
  name: string;
  /** Simplified node type: frame | text | rect | ellipse | instance | ... */
  type: string;
  box: { w: number; h: number };
  layout?: PdsLayout;
  /**
   * Position relative to the parent's top-left, in CSS pixels. Emitted when
   * the parent has no auto-layout (so children are absolutely positioned)
   * or when the child overrides layout with Figma's "Absolute position"
   * toggle. Omitted when the parent's auto-layout resolves placement.
   */
  pos?: { x: number; y: number };
  /**
   * Compact dominant fill — token ref `$cN` for solids, or the markers
   * "gradient" / "image" for the non-solid case. Legacy / convenience field;
   * the full stack lives in `fills` whenever there is more than one fill or
   * the fill is non-solid.
   */
  fill?: string;
  /**
   * Full fill stack, bottom-up. Emitted whenever the single-string `fill`
   * representation would be lossy — i.e. multiple paints layered, a
   * gradient (with all its stops), or an image (with its asset id). Render
   * these as `background: <layer-1>, <layer-2>, …` in CSS order.
   */
  fills?: Fill[];
  /**
   * Token ref `$cN` resolved from the nearest ancestor with a solid fill.
   * Emitted only when this node has no `fill` of its own — saves the renderer
   * from walking up the tree to figure out what shows through. Frames /
   * groups / rects only; text and vector nodes don't carry it.
   */
  inheritedFill?: string;
  stroke?: string;
  strokeW?: number;
  /**
   * Where the stroke sits relative to the geometry. CSS `border` is always
   * inside, so for `outside` / `center` the renderer needs to compensate
   * with `outline` + `outline-offset` or an extra wrapping box, otherwise
   * the element comes out 2-4px smaller than the Figma source.
   */
  strokeAlign?: "inside" | "outside" | "center";
  /**
   * Per-side stroke weights when not uniform. Emitted only when at least
   * one side differs from `strokeW`. Renders to `border-{top,right,bottom,left}-width`.
   */
  strokeSides?: { t: number; r: number; b: number; l: number };
  /**
   * Dash lengths in CSS px — e.g. `[4, 4]` for a 4-on / 4-off dashed
   * border. Maps to `border-style: dashed` plus `border-image` if exact
   * dash control is needed. Empty / missing means solid.
   */
  strokeDash?: number[];
  /** Token ref into tokens.radius, or a per-corner [tl,tr,br,bl] tuple. */
  radius?: string | [number, number, number, number];
  /**
   * Compact dominant shadow — CSS `box-shadow` string for back-compat.
   * Multi-shadow stacks and blur effects live in `effects`.
   */
  shadow?: string;
  /**
   * Full effect stack — drop / inner shadows, layer blur (CSS `filter`),
   * and background blur (CSS `backdrop-filter`). Emitted whenever the stack
   * is non-trivial. `backdropFilter` below is the CSS-ready shorthand.
   */
  effects?: Effect[];
  /**
   * Convenience: ready-to-paste CSS `backdrop-filter` value (e.g.
   * `"blur(24px)"`) when this node has a Figma `background-blur` effect.
   * Use this on frosted-glass panels.
   */
  backdropFilter?: string;
  opacity?: number;
  clip?: boolean;
  /** Token ref into tokens.text (TEXT nodes only). */
  text?: string;
  /**
   * CSS `text-decoration-line` — `underline` or `line-through`. Emitted on
   * TEXT nodes whose Figma decoration is non-NONE. Catches completed
   * checklist items (strike-through), inline links (underline), etc.
   */
  textDecoration?: "underline" | "line-through";
  /** The actual text content (TEXT nodes only). */
  chars?: string;
  /** mainComponent id (INSTANCE nodes only). */
  component?: string;
  /**
   * Asset id when this node renders an image. Mirrors the first
   * `ImageFill.assetId` in `fills`; surfaced at the top level so the agent
   * can tag the rendered `<img>` with `data-plumb-asset="<id>"` without
   * walking the fill stack.
   */
  assetId?: string;
  /**
   * Hint for icon-swap flows. Set on small image-filled / vector nodes whose
   * intent can be inferred from the design context (a sibling TEXT label
   * inside the same button, or a descriptive ancestor name). Example: a 24×24
   * IMAGE inside a Button whose other child is the text "Get started" gets
   * `iconHint: "Get started"`. Useful for replacing bitmap icons with
   * codebase line-icons without having to read the pixels.
   */
  iconHint?: string;
  /**
   * Detected semantic UI pattern. Currently `"button"` for row-layout clusters
   * sized like a button (≤480×80), with stroke or fill, radius, and at least
   * one TEXT child. Saves the renderer from re-discovering "this is a button"
   * by geometric inspection — map directly to the codebase's Button component.
   */
  pattern?: string;
  /**
   * Figma prototype transitions wired to this node. Pure design intent —
   * Plumb does not verify these at runtime today.
   */
  motion?: MotionSpec[];
  /**
   * Auto-layout child sizing — emitted on children of auto-layout parents
   * when non-default. The renderer applies these as flex properties:
   *   - `grow: 1` → `flex-grow: 1` (fill remaining main-axis space)
   *   - `selfAlign: "stretch"` → `align-self: stretch` (cross-axis fill)
   *   - `sizing.w: "fill"` → main-axis fill on row / cross-axis stretch on col
   *   - `sizing.h: "fill"` → main-axis fill on col / cross-axis stretch on row
   *   - `sizing.{w,h}: "hug"` → shrink to content (the default flex item
   *     behavior, but explicit when Figma flagged it so the agent doesn't
   *     apply a hardcoded width/height).
   * Without these fields, agents default to flex's "shrink to content" and
   * stretchy columns collapse — the #1 "almost right" layout failure.
   */
  grow?: number;
  selfAlign?: "stretch" | "min" | "center" | "max";
  sizing?: { w?: "fill" | "hug"; h?: "fill" | "hug" };
  /** Child `el` handles — present when this node's children are included. */
  children?: string[];
  /**
   * Set instead of `children` at the disclosure boundary: this many children
   * exist but were not included. Call plumb_node again on this node's `id`
   * to expand them (progressive disclosure, plan §5/§7).
   */
  more?: number;
  /** Opt-in human-readable hints (plan §7). */
  notes?: string[];
  /**
   * This node is a Figma mask — it shapes its subsequent siblings inside the
   * same container rather than rendering as its own surface. The renderer
   * should NOT paint this node directly; use its `fills` (gradient / image /
   * shape) as the CSS `mask-image` of every sibling whose `masked` references
   * this node's `el`. `maskMode` mirrors CSS `mask-type`: `"alpha"` reads
   * alpha channel, `"luminance"` reads luminance, `"vector"` is a vector clip.
   */
  isMask?: boolean;
  maskMode?: "alpha" | "luminance" | "vector";
  /**
   * El of the sibling mask that shapes this node. Emitted on every sibling
   * after a mask child inside the same container. Use the mask node's `fills`
   * as `mask-image` and `mask-mode: <mask.maskMode>` on the masked element.
   */
  masked?: string;
}

export interface TokenTable {
  color: Record<string, string>;
  text: Record<string, string>;
  /**
   * Pixel radii, or the literal string "full" for fully-rounded shapes (pill /
   * circle). Figma stores "fully rounded" as a giant sentinel integer
   * (`21243700`, `33990048`, …) — Plumb normalises those to "full" so an
   * agent never has to guess whether `21243700` is literal pixels.
   */
  radius: Record<string, number | "full">;
  shadow: Record<string, string>;
}

export interface PdsDocument {
  file: { name: string; version: string };
  /** `el` of the requested root node. */
  root: string;
  tokens: TokenTable;
  /** Flat map of `el` → node. Parents reference children by `el`. */
  nodes: Record<string, PdsNode>;
  meta: {
    nodeCount: number;
    estTokens: number;
    depthUsed: number;
    truncated?: boolean;
    hint?: string;
    /**
     * Likely typos in TEXT nodes — single-edit outliers from a dominant
     * sibling/cluster value. Conservative: only flagged when ≥3 nearby texts
     * agree and exactly one diverges by 1–2 edits. Designers ship typos all
     * the time and a faithful extractor preserves them; this hint surfaces
     * them so the agent can ask the user instead of silently shipping.
     */
    suspiciousText?: SuspiciousText[];
  };
  /** Suggested next step for the agent (plan §6.1). */
  next: string;
}

export interface SuspiciousText {
  path: string;
  value: string;
  hint: string;
}
