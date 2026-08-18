/**
 * Interaction, expressed as something an implementer can act on.
 *
 * Figma models this as reactions hanging off a node; a PDS models it as a flat
 * spec with a trigger, an action, and a transition. Same information, in the
 * shape the person writing the code actually needs it.
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
