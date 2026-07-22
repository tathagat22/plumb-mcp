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

/**
 * One repeating sibling cluster: a template el (kept fully in `nodes`) and a
 * per-instance delta map for every compressed sibling that follows it. The
 * compressed sibling els still appear in `parent.children` so the renderer
 * walks them in order; their entries are missing from `nodes` (intentional)
 * and the renderer hydrates them by reading the matching `data` entry.
 */
export interface PdsRepeatGroup {
  template: string;
  data: Record<
    string,
    Record<string, { chars?: string | PdsTextRun[]; assetId?: string; iconHint?: string }>
  >;
}

/**
 * A single styled run inside a TEXT node with mixed inline styles. The
 * dominant style still sits on the node (`text`, `fill`) so simple
 * renderers can ignore runs and ship the concatenated text correctly;
 * run-aware renderers compose `<span>`s with the per-run overrides.
 *
 * `s` and `c` are emitted only when the run diverges from the dominant.
 */
export interface PdsTextRun {
  /** Literal text for this run. */
  t: string;
  /** Type-style override — `$tN` ref into `tokens.text`. Omit if matches dominant. */
  s?: string;
  /** Colour override — `$cN` ref into `tokens.color`. Omit if matches dominant. */
  c?: string;
  /** "underline" / "line-through" override. Omit if matches dominant. */
  d?: "underline" | "line-through";
  /** `textCase` override — a differently-cased word/link within a run of
   *  otherwise-uncased text. Omit if matches the node's dominant `textCase`. */
  tc?: "UPPER" | "LOWER" | "TITLE";
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
  /**
   * Figma Variable name bound to this colour (e.g. `"colors/brand/primary"`).
   * When present, prefer `var(--colors-brand-primary)` (or the codebase's
   * equivalent token reference) over the resolved hex — the variable is
   * the design-system intent; the hex is just its current value. Only
   * shipped via the plugin path; REST cannot reliably resolve variable
   * IDs to names.
   */
  var?: string;
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
  /**
   * 2×3 affine crop matrix (v0.10+). Present when the user dragged the
   * source image around inside the node — without it, agents render a
   * default-centered crop and the photo lands wrong.
   */
  crop?: number[][];
  /** Image rotation, degrees clockwise (v0.10+). Omitted at 0°. */
  rotation?: number;
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
  /**
   * Overlay positioning when the action opens an overlay (v0.10+). Without
   * this, agents default a destination overlay to a centered modal even
   * when the design intends a top-pinned sheet or absolutely-positioned drawer.
   */
  overlay?: {
    /** Pixel offset from the parent overlay's top-left. */
    pos?: { x: number; y: number };
    /** Backdrop colour (CSS hex) — empty/absent means transparent. */
    background?: string;
  };

  // ---- Write-direction authoring extension (blueprint §9.9) ----------------
  // Additive, all optional. The read side leaves these undefined; the DSL
  // compiler / motion authoring set them so a write→read→write round-trip can
  // carry the prototype action verb, timing, and destination presentation.
  /** Prototype action verb — read side infers it from `target`; write sets it. */
  navigation?: string;
  /** Directional transition slide direction (LEFT/RIGHT/TOP/BOTTOM). */
  direction?: string;
  /** Smart-animate layer matching. */
  matchLayers?: boolean;
  /** `AFTER_TIMEOUT` delay, ms. */
  timeout?: number;
  /** `ON_KEY_DOWN` JS key codes. */
  keys?: number[];
  /** `URL` action destination. */
  url?: string;
  /** `SET_VAR` action — Figma variable id → value. */
  setVars?: Record<string, string | number | boolean>;
  /** Keep the destination's scroll position on navigate. */
  preserveScroll?: boolean;
  /** Reset interactive-component / variant state on navigate. */
  resetState?: boolean;
  /** Custom spring easing params (what the CSS `easing` string can't hold). */
  spring?: { mass: number; stiffness: number; damping: number };
}

/** Destination-frame overlay presentation (additive `PdsNode.overlayCfg`). */
export interface PdsOverlayCfg {
  position?:
    | "center"
    | "top"
    | "bottom"
    | "left"
    | "right"
    | "top-left"
    | "top-right"
    | "bottom-left"
    | "bottom-right"
    | "manual";
  at?: { x: number; y: number };
  backdrop?: string;
  closeOnClickOutside?: boolean;
}

/** File-level flow config (additive `PdsDocument.prototype`). */
export interface PdsPrototype {
  /** Flow starting frames (authored el → display name). */
  starts?: { el: string; name: string }[];
  device?: {
    kind: "none" | "preset" | "custom";
    preset?: string;
    size?: { w: number; h: number };
    rotation?: "portrait" | "landscape";
  };
  background?: string;
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
  /**
   * Figma layer name. Dropped when it matches Figma's auto-generated
   * pattern (`Frame 12`, `Rectangle 3`, `Vector`, etc.) — those carry no
   * semantic information and the `el` handle already encodes identity.
   * Present only when the name is descriptive ("Submit button",
   * "Header").
   */
  name?: string;
  /** Simplified node type: frame | text | rect | ellipse | instance | ... */
  type: string;
  box: { w: number; h: number };
  /**
   * Auto-layout config. May be the literal object or a `$lN` ref into
   * `tokens.layout` (v0.10+, when the same config repeats across siblings —
   * e.g. every row in a list shares one layout). Resolve refs by lookup;
   * unresolvable strings should be treated as opaque tokens, not values.
   */
  layout?: PdsLayout | string;
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
   * these as `background: <layer-1>, <layer-2>, …` in CSS order. May be a
   * `$fN` ref into `tokens.fills` (v0.10+) when the same stack repeats —
   * common for gradient CTAs or branded surfaces.
   */
  fills?: Fill[] | string;
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
   * Figma Variable name bound to the (uniform) corner radius (e.g.
   * `"radii/md"`). Only emitted via the plugin path. Per-corner variable
   * bindings aren't surfaced yet.
   */
  radiusVar?: string;
  /**
   * Compact dominant shadow — CSS `box-shadow` string for back-compat.
   * Multi-shadow stacks and blur effects live in `effects`.
   */
  shadow?: string;
  /**
   * Full effect stack — drop / inner shadows, layer blur (CSS `filter`),
   * and background blur (CSS `backdrop-filter`). Emitted whenever the stack
   * is non-trivial. `backdropFilter` below is the CSS-ready shorthand. May
   * be a `$eN` ref into `tokens.effects` (v0.10+) for repeating elevation
   * stacks (cards, surfaces).
   */
  effects?: Effect[] | string;
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
  /**
   * CSS `text-transform` — Figma's `textCase` style property. Maps to
   * `uppercase`/`lowercase`/`capitalize` (button labels, eyebrow text,
   * section kickers commonly rely on this rather than the source string
   * literally containing the cased characters). Figma's `SMALL_CAPS` /
   * `SMALL_CAPS_FORCED` variants are a distinct `font-variant` concept, not
   * `text-transform`, and are omitted rather than approximated.
   */
  textCase?: "UPPER" | "LOWER" | "TITLE";
  /**
   * The actual text content (TEXT nodes only). When the Figma node has
   * mixed inline styles — bold word in a sentence, coloured link in a
   * paragraph, anything where `getStyledTextSegments` returns more than
   * one run — this is a `PdsTextRun[]` instead of a string. The dominant
   * style sits on `text` / `fill`; per-run overrides ride on the run.
   */
  chars?: string | PdsTextRun[];
  /**
   * mainComponent id (INSTANCE nodes only). May arrive as a structured
   * object `{ id, variant: "Size=md,Style=primary" }` (v0.10+) when the
   * underlying component has variants — the variant string is Figma's
   * `variantProperties` flattened, so an agent can route to the right
   * codebase variant without a separate `props` round-trip.
   */
  component?: string | { id: string; variant?: string };
  /**
   * Component property overrides on an INSTANCE — e.g.
   * `{ Label: "Sign in", Variant: "primary", Icon: true }`. Lets agents
   * render the instance with the correct props instead of always
   * defaulting (`<Button label="Sign in" variant="primary" icon />`
   * vs. `<Button />`). Keys are Figma's property names with the
   * internal `#id:idx` suffix stripped. Closes the #1 component-intent
   * gap from feedbackstowor.txt. May be a `$pN` ref into `tokens.props`
   * (v0.10+) when the same override map repeats across instances — common
   * for components with a small number of variant combinations.
   */
  props?: Record<string, string | boolean | number> | string;
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
   * Detected semantic UI role. Leaf-level: `"button"` for row-layout clusters
   * sized like a button (≤480×80), with stroke or fill, radius, and at least
   * one TEXT child (still inferred inline during normalize()'s walk). Container-
   * level (v0.14+, projected from `src/semantic/enrichers/role.ts` via the
   * Semantic Graph — see `docs/ROADMAP-v0.14-design-intelligence.md` §10 M2):
   * `"nav"` / `"hero"` / `"footer"` / `"sidebar"` among the requested root's
   * direct children, and `"card"` on a repeat-group template that's both a
   * styled surface (radius/shadow/effects, or fill+stroke) and carries its
   * own text. Conservative by construction — a missing label just means the
   * signals didn't line up, never trust it over what you can see in the
   * screenshot. Saves the renderer from re-discovering "this is a button" /
   * "this is the nav" by geometric inspection every call.
   */
  pattern?: string;
  /**
   * 0..1 confidence for a container-level `pattern` (nav/hero/footer/
   * sidebar/card) — how comfortably the classifier's numeric thresholds
   * were cleared, not a probability. Absent for the leaf-level `"button"`
   * pattern (that detector doesn't score itself) and for any container
   * label produced by an enricher version that predates this field. A
   * present-but-low score (roughly 0.5–0.6) still means the label is the
   * classifier's real, gate-passed answer — just a marginal one; weight it
   * accordingly rather than distrusting it outright.
   */
  patternConfidence?: number;
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
  sizing?: { w?: "fill" | "hug" | "fixed"; h?: "fill" | "hug" | "fixed" };
  /** Child `el` handles — present when this node's children are included. */
  children?: string[];
  /**
   * Compressed repeating sibling block. When ≥ 3 consecutive children
   * share an identical structural shape (modulo `chars` and `assetId`),
   * only the FIRST child is emitted as a full node in `nodes`; the rest
   * appear here as per-instance overrides keyed by the EL inside the
   * template that varies.
   *
   * Render by walking `parent.children` in order — for each el, look it up
   * in `nodes`. Misses are compressed siblings; find them in the matching
   * `parent.repeat` group's `data` and render with `nodes[group.template]`
   * + the per-instance overrides:
   *
   *   const groups = Array.isArray(parent.repeat)
   *     ? parent.repeat
   *     : parent.repeat ? [parent.repeat] : [];
   *   for (const el of parent.children) {
   *     const full = nodes[el];
   *     if (full) { render(full); continue; }
   *     const g = groups.find((g) => g.data[el]);
   *     if (g) render(nodes[g.template], g.data[el]);
   *   }
   *
   * Closes the biggest agent-token bleed: a 10-row settings list ships
   * as 1 template + 9 small override maps instead of 10 full subtrees.
   *
   * v0.10 Phase 4: when the parent contains several distinct repeating
   * clusters (Header + rows + Spacer + cards), `repeat` is an array, one
   * group per run.
   */
  repeat?: PdsRepeatGroup | PdsRepeatGroup[];
  /**
   * Set instead of `children` at the disclosure boundary: this many children
   * exist but were not included. Call plumb_node again on this node's `id`
   * to expand them (progressive disclosure, plan §5/§7).
   */
  more?: number;
  /**
   * Set instead of `children` when this subtree was semantically collapsed
   * (v0.14+, `plumb_node`'s `collapseRoles` param — see
   * `src/semantic/project/collapse.ts`) rather than truncated by depth: a
   * one-line, deterministically-generated structural description (box size,
   * child count, up to 3 child descriptors) standing in for the full
   * subtree. `more` is still set alongside it to the hidden descendant
   * count, so the disclosure contract ("call plumb_node on this node's `id`
   * to expand") is identical either way — this is depth-based truncation's
   * sibling, triggered by a confident semantic role instead of a depth
   * boundary, not a different mechanism the agent has to learn.
   */
  summary?: string;
  /** Opt-in human-readable hints (plan §7). */
  notes?: string[];
  /**
   * Inline SVG path data for vector shapes (VECTOR / BOOLEAN_OPERATION /
   * STAR / POLYGON / LINE / ELLIPSE). When present, the agent can render
   * the icon directly without a `plumb_assets` round-trip:
   *
   *     <svg viewBox="0 0 {box.w} {box.h}"><path d="{vectorPath}" /></svg>
   *
   * Only emitted when the path fits in a per-node budget (≤ 600 chars
   * combined). Larger / multi-rule paths still ship via `plumb_assets`.
   *
   * May be a `$vN` ref into `tokens.vector` (v0.10+) when the same icon
   * shape repeats — common for nav/tab icons used across screens. Raw `d`
   * strings always start with a path command (M/m/L/l/C/c/...) so a leading
   * `$` is unambiguously a ref, not data.
   */
  vectorPath?: string;
  /**
   * Which combine operation produced a `type: "bool"` (BOOLEAN_OPERATION)
   * node — lowercased to match CSS/JS naming conventions elsewhere in PDS.
   * Only the generic `"bool"` type marker was previously surfaced, so an
   * agent reconstructing the shape (rather than using `vectorPath`/
   * `plumb_assets`) had no way to know union vs. subtract vs. intersect.
   */
  boolOp?: "union" | "intersect" | "subtract" | "exclude";
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

  // v0.10 Phase 3 — fidelity additions. Each field is omitted when the
  // value is the CSS default (no rotation, normal blend, square corners,
  // text doesn't grow, no constraints, no min/max). Agents that ignore
  // these still get the right visual; agents that respect them get
  // pixel-identical output on rotated icons, frosted blends, squircle
  // surfaces, responsive text, and pinned absolutely-positioned children.
  rotation?: number;
  blend?: string;
  smooth?: number;
  /**
   * Text auto-resize:
   *   "h"  → height grows with content (fixed width)
   *   "wh" → both axes grow with content
   *   "trunc" → fixed box, ellipsize when overflowing
   * Omitted = NONE (fixed box, content wraps/overflows).
   */
  textGrow?: "h" | "wh" | "trunc";
  /**
   * Pinning rules for children of a non-auto-layout parent. CSS-friendly
   * shorthand:
   *   h: "left" | "right" | "center" | "stretch" | "scale"
   *   v: "top" | "bottom" | "center" | "stretch" | "scale"
   * Combine with `pos` to lay out absolute children that should pin to
   * an edge or center inside a resizing parent.
   */
  constraints?: { h?: string; v?: string };
  /**
   * Per-axis size floor/ceiling — kicks in when `sizing.{w,h}` is "fill"
   * or "hug" and the layout would otherwise let the box collapse below
   * `min` or expand past `max`.
   */
  sizingMin?: { w?: number; h?: number };
  sizingMax?: { w?: number; h?: number };

  // ---- Write-direction authoring extension (blueprint §9.9, additive) ------
  /** Text horizontal alignment (TEXT nodes). Read side omits; write sets it. */
  textAlign?: "left" | "center" | "right" | "justified";
  /** Frame scroll overflow — drives the destination frame's `overflowDirection`. */
  overflow?: "none" | "horizontal" | "vertical" | "both";
  /** Overlay presentation config when this frame is opened as an overlay. */
  overlayCfg?: PdsOverlayCfg;
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
  /**
   * Compound token namespaces — v0.10. Each maps `$xN` → the structured
   * value previously emitted inline on every node. Only present when the
   * file actually contains repeating compounds; an empty namespace is
   * omitted rather than emitted as `{}`.
   *
   * Resolution rule for agents: when `node.layout` (or .effects/.fills/etc)
   * is a string, look it up here. When it's the literal value, use as-is.
   * Both shapes are valid in the same response.
   */
  layout?: Record<string, PdsLayout>;
  effects?: Record<string, Effect[]>;
  fills?: Record<string, Fill[]>;
  vector?: Record<string, string>;
  props?: Record<string, Record<string, string | boolean | number>>;
  /**
   * Per-ref hit counts (≥2 only) — measurable proof of dedup. Inspect
   * `tokens.meta.counts` to see which compounds are doing real work; useful
   * when comparing "tokens before / tokens after" on a real screen.
   */
  meta?: { counts?: Record<string, number> };
}

/**
 * PDS wire-shape version — independent of `plumb-mcp`'s own npm version
 * (`SERVER_VERSION`, src/meta.ts), which bumps on every release regardless
 * of whether the wire shape changed. Bump this only on an actual breaking
 * change to `PdsDocument`/`PdsNode`'s shape, so a client that snapshot-tests
 * its own parsing has something concrete to check against. Mirrors
 * `SemanticGraph.cirVersion`'s identical convention (src/semantic/graph.ts).
 */
export const PDS_SCHEMA_VERSION = "1.0.0";

export interface PdsDocument {
  /** See {@link PDS_SCHEMA_VERSION}. */
  schemaVersion: string;
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
  /** File-level prototype flow config (additive, write direction). */
  prototype?: PdsPrototype;
}

export interface SuspiciousText {
  path: string;
  value: string;
  hint: string;
}
