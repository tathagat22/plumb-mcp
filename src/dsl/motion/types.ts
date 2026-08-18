/**
 * The two type vocabularies motion authoring lives between.
 *
 * First, the additive PDS fields (blueprint §9.9): `AuthoredMotionSpec extends
 * MotionSpec`, so the read side's trigger/kind/easing string conventions carry
 * over unchanged — `trigger:"ON_CLICK"`, `kind:"SMART_ANIMATE"`,
 * `easing:"cubic-bezier(...)"`. That symmetry is the point: a design Plumb
 * generates and a design Plumb reads describe interaction identically.
 *
 * Second, the `apply-motion` wire contract (blueprint §2) the plugin executor
 * consumes. Kept here rather than in bridge/protocol.ts because it is still the
 * authoritative definition; see the followup to lift it.
 */

import type { MotionSpec, PdsDocument, PdsNode } from "../../pds";

// ============================================================================
// Additive PDS motion fields (blueprint §9.9 merges these into src/pds.ts;
// defined here so this module compiles before that edit — see followups).
// ============================================================================

/** `MotionSpec` + the write-direction authoring extension. Read/write share the
 *  base fields (trigger/kind/duration/easing/target/overlay). */
export interface AuthoredMotionSpec extends MotionSpec {
  /** Prototype action verb; read side infers it from `target`, write sets it. */
  navigation?: WireNavigation;
  /** Directional transition slide-in direction. */
  direction?: WireDirection;
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
  /** Custom spring easing parameters (params the CSS `easing` string can't hold). */
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

/** Additive `PdsDocument.prototype` — file-level flow config. */
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

/** PDS node read with the additive motion fields the blueprint merges into pds.ts. */
export interface MotionPdsNode extends PdsNode {
  overflow?: "none" | "horizontal" | "vertical" | "both";
  overlayCfg?: PdsOverlayCfg;
}

/** PDS document read with the additive `prototype` field. */
export interface MotionPdsDocument extends PdsDocument {
  prototype?: PdsPrototype;
}

// ============================================================================
// Wire contract (blueprint §2 — the `apply-motion` payload). Authoritative
// here until protocol.ts adopts it.
// ============================================================================

export type WireTrigger =
  | "ON_CLICK"
  | "ON_HOVER"
  | "ON_PRESS"
  | "ON_DRAG"
  | "MOUSE_ENTER"
  | "MOUSE_LEAVE"
  | "MOUSE_UP"
  | "MOUSE_DOWN"
  | "AFTER_TIMEOUT"
  | "ON_KEY_DOWN";

export type WireNavigation =
  | "NAVIGATE"
  | "SWAP"
  | "OVERLAY"
  | "SCROLL_TO"
  | "BACK"
  | "CLOSE"
  | "URL"
  | "SET_VAR";

export type WireTransitionKind =
  | "SMART_ANIMATE"
  | "DISSOLVE"
  | "MOVE_IN"
  | "MOVE_OUT"
  | "PUSH"
  | "SLIDE_IN"
  | "SLIDE_OUT"
  | "SCROLL_ANIMATE"
  | "INSTANT";

export type WireDirection = "LEFT" | "RIGHT" | "TOP" | "BOTTOM";

export interface WireSpec {
  trigger: WireTrigger;
  navigation: WireNavigation;
  /** Destination PDS el (resolved to a Figma id via the emit idMap on the plugin). */
  target?: string;
  kind?: WireTransitionKind;
  direction?: WireDirection;
  /** ms; the emit executor divides by 1000. */
  durationMs?: number;
  /** named (`ease-out`) | `bezier:x1,y1,x2,y2` | `spring:mass,stiff,damp`. */
  easing?: string;
  matchLayers?: boolean;
  timeoutMs?: number;
  keys?: number[];
  url?: string;
  /** key = Figma variable id. */
  setVars?: Record<string, string | number | boolean>;
  preserveScroll?: boolean;
  resetState?: boolean;
}

export interface WireBinding {
  sourceEl: string;
  specs: WireSpec[];
}

export type WireOverlayPosition =
  | "CENTER"
  | "TOP_LEFT"
  | "TOP_CENTER"
  | "TOP_RIGHT"
  | "BOTTOM_LEFT"
  | "BOTTOM_CENTER"
  | "BOTTOM_RIGHT"
  | "MANUAL";

export interface WireOverlay {
  position: WireOverlayPosition;
  at?: { x: number; y: number };
  backdrop?: string;
  closeOnClickOutside?: boolean;
}

export interface WireFrame {
  el: string;
  overflow?: "NONE" | "HORIZONTAL" | "VERTICAL" | "BOTH";
  /** Applied to the DESTINATION frame, not the click source. */
  overlay?: WireOverlay;
}

export interface WirePrototype {
  starts: { el: string; name: string }[];
  device?: {
    kind: "none" | "preset" | "custom";
    preset?: string;
    size?: { w: number; h: number };
    rotation?: "NONE" | "CW_90";
  };
  background?: string;
}

export interface MotionPlan {
  bindings: WireBinding[];
  frames: WireFrame[];
  prototype?: WirePrototype;
}

export interface MotionResult {
  wired: number;
  misses: string[];
  error: string | null;
}
