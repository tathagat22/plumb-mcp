/**
 * Motion authoring — the write-direction mirror of the read-side reaction
 * serializer (figma-plugin/code.ts `serializeReactions` + normalize.ts
 * `motionFromReactions`).
 *
 * Two responsibilities, folded into one module (blueprint file map lists these
 * as `src/emit/motion/compile.ts` + `src/emit/motion/plan.ts`; the build task
 * lands both here):
 *
 *   1. compile — DSL `interactions` / `DslPrototype` → PDS motion fields.
 *      `compileInteractions()` returns `AuthoredMotionSpec[]` (the read-side
 *      `MotionSpec` shape from src/pds.ts, plus the additive authoring fields
 *      the blueprint §9.9 merges into `MotionSpec`). The block lowerer assigns
 *      the result to `PdsNode.motion`; `compilePrototype()` produces the
 *      additive `PdsDocument.prototype`.
 *
 *   2. plan — `buildMotionPlan()` walks the assembled PDS and lowers every
 *      `node.motion` / `node.overflow` / `node.overlayCfg` / `doc.prototype`
 *      into the `MotionPlan` wire contract (blueprint §2) that rides
 *      `apply-motion` to the plugin executor (figma-plugin/motion-emit.ts).
 *
 * Symmetry: `AuthoredMotionSpec extends MotionSpec`, so the exact read-side
 * trigger/kind/easing string conventions are reused (e.g. `trigger:"ON_CLICK"`,
 * `kind:"SMART_ANIMATE"`, `easing:"cubic-bezier(...)"` / `"ease-out"`).
 *
 * This file is standalone: it imports only DSL types (./schema) and PDS types
 * (../pds). The wire contract below is the authoritative definition until the
 * integration agent lifts it into src/bridge/protocol.ts (see followups).
 */

import type {
  DslEasing,
  DslInteraction,
  DslOverlayConfig,
  DslPrototype,
  DslTransition,
  DslTrigger,
} from "./schema";
import type { MotionSpec, PdsDocument, PdsNode } from "../pds";

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

// ============================================================================
// Compile: DSL → AuthoredMotionSpec[] (read-symmetric PDS motion)
// ============================================================================

export interface MotionCompileCtx {
  /** Map a DSL screen/section id (from `go`/`swap`/`overlay`/`scrollTo`) to a
   *  PDS el. When omitted the ref passes through unchanged (resolved later). */
  resolveTarget?: (ref: string) => string | undefined;
  warn?: (message: string) => void;
}

const TRIGGER_MAP: Record<string, WireTrigger> = {
  click: "ON_CLICK",
  hover: "ON_HOVER",
  press: "ON_PRESS",
  drag: "ON_DRAG",
  "mouse-enter": "MOUSE_ENTER",
  "mouse-leave": "MOUSE_LEAVE",
  "mouse-down": "MOUSE_DOWN",
  "mouse-up": "MOUSE_UP",
};

const TRANSITION_KIND_MAP: Record<DslTransition["kind"], WireTransitionKind> = {
  smart: "SMART_ANIMATE",
  dissolve: "DISSOLVE",
  "move-in": "MOVE_IN",
  "move-out": "MOVE_OUT",
  push: "PUSH",
  "slide-in": "SLIDE_IN",
  "slide-out": "SLIDE_OUT",
  "scroll-animate": "SCROLL_ANIMATE",
  instant: "INSTANT",
};

/** JS key codes for the common `key:<name>` triggers. */
const KEY_CODES: Record<string, number> = {
  enter: 13,
  return: 13,
  esc: 27,
  escape: 27,
  space: 32,
  spacebar: 32,
  tab: 9,
  backspace: 8,
  delete: 46,
  up: 38,
  down: 40,
  left: 37,
  right: 39,
  home: 36,
  end: 35,
};

function parseKeys(name: string): number[] {
  const key = name.trim().toLowerCase();
  if (!key) return [];
  if (key in KEY_CODES) return [KEY_CODES[key] as number];
  if (/^\d+$/.test(key)) return [parseInt(key, 10)];
  // Single character → its uppercase char code (Figma uses JS keyCodes).
  const first = key[0];
  if (first) return [first.toUpperCase().charCodeAt(0)];
  return [];
}

function parseTrigger(on: DslTrigger): {
  trigger: WireTrigger;
  timeout?: number;
  keys?: number[];
} {
  if (on.startsWith("key:")) {
    return { trigger: "ON_KEY_DOWN", keys: parseKeys(on.slice(4)) };
  }
  if (on.startsWith("after:")) {
    const ms = parseInt(on.slice(6), 10);
    return { trigger: "AFTER_TIMEOUT", timeout: Number.isFinite(ms) ? ms : 0 };
  }
  return { trigger: TRIGGER_MAP[on] ?? "ON_CLICK" };
}

/** DSL easing → the read-side CSS-shaped `easing` string (+ spring params). */
function dslEasingToMotion(e: DslEasing | undefined): {
  easing?: string;
  spring?: { mass: number; stiffness: number; damping: number };
} {
  if (!e) return {};
  if (typeof e === "string") return { easing: e };
  if ("bezier" in e) {
    const [a, b, c, d] = e.bezier;
    return { easing: `cubic-bezier(${a},${b},${c},${d})` };
  }
  if ("spring" in e) return { easing: "custom-spring", spring: e.spring };
  return {};
}

const NODE_NAVS: ReadonlySet<WireNavigation> = new Set([
  "NAVIGATE",
  "SWAP",
  "OVERLAY",
  "SCROLL_TO",
]);

interface ActionParts {
  navigation: WireNavigation;
  target?: string;
  url?: string;
  setVars?: Record<string, string | number | boolean>;
}

function actionOf(it: DslInteraction, ctx: MotionCompileCtx): ActionParts | null {
  const resolve = (ref: string): string => ctx.resolveTarget?.(ref) ?? ref;
  if (it.go !== undefined) return { navigation: "NAVIGATE", target: resolve(it.go) };
  if (it.swap !== undefined) return { navigation: "SWAP", target: resolve(it.swap) };
  if (it.overlay !== undefined) return { navigation: "OVERLAY", target: resolve(it.overlay) };
  if (it.scrollTo !== undefined) return { navigation: "SCROLL_TO", target: resolve(it.scrollTo) };
  if (it.back) return { navigation: "BACK" };
  if (it.close) return { navigation: "CLOSE" };
  if (it.url !== undefined) return { navigation: "URL", url: it.url };
  if (it.set !== undefined) return { navigation: "SET_VAR", setVars: it.set };
  return null;
}

/** Lower one DSL interaction to a read-symmetric `AuthoredMotionSpec`. */
export function compileInteraction(
  it: DslInteraction,
  ctx: MotionCompileCtx = {},
): AuthoredMotionSpec | null {
  const action = actionOf(it, ctx);
  if (!action) {
    ctx.warn?.(`interaction on "${it.on}" has no action verb; skipped`);
    return null;
  }

  const { trigger, timeout, keys } = parseTrigger(it.on);
  const spec: AuthoredMotionSpec = {
    trigger,
    kind: "INSTANT",
    navigation: action.navigation,
  };
  if (action.target !== undefined) spec.target = action.target;
  if (action.url !== undefined) spec.url = action.url;
  if (action.setVars !== undefined) spec.setVars = action.setVars;
  if (timeout !== undefined) spec.timeout = timeout;
  if (keys !== undefined) spec.keys = keys;

  if (it.animate) {
    const t = it.animate;
    spec.kind = TRANSITION_KIND_MAP[t.kind] ?? "INSTANT";
    if (t.from) spec.direction = t.from.toUpperCase() as WireDirection;
    spec.duration = t.duration ?? 300;
    const { easing, spring } = dslEasingToMotion(t.ease);
    if (easing) spec.easing = easing;
    if (spring) spec.spring = spring;
    if (t.matchLayers !== undefined) spec.matchLayers = t.matchLayers;
  }

  if (it.keepScroll) spec.preserveScroll = true;
  if (it.resetState) spec.resetState = true;
  return spec;
}

/** Lower a block's `interactions` to `PdsNode.motion`. */
export function compileInteractions(
  interactions: DslInteraction[] | undefined,
  ctx: MotionCompileCtx = {},
): AuthoredMotionSpec[] {
  if (!interactions?.length) return [];
  const out: AuthoredMotionSpec[] = [];
  for (const it of interactions) {
    const spec = compileInteraction(it, ctx);
    if (spec) out.push(spec);
  }
  return out;
}

/** Map a DSL page `overlay` / `scroll` config to the additive `PdsNode.overlayCfg`. */
export function compileOverlayCfg(cfg: DslOverlayConfig | undefined): PdsOverlayCfg | undefined {
  if (!cfg) return undefined;
  const out: PdsOverlayCfg = {};
  if (cfg.position) out.position = cfg.position;
  if (cfg.at) out.at = cfg.at;
  if (cfg.backdrop) out.backdrop = cfg.backdrop;
  if (cfg.closeOnClickOutside !== undefined) out.closeOnClickOutside = cfg.closeOnClickOutside;
  return out;
}

/**
 * Build the additive `PdsDocument.prototype` from the doc-level `DslPrototype`
 * plus the flow-start frames the section/page lowerer collected (authored el →
 * display name). `starts` should already include the frame named by
 * `proto.start` (the compiler owns the id→el map).
 */
export function compilePrototype(
  proto: DslPrototype | undefined,
  starts: { el: string; name: string }[],
): PdsPrototype | undefined {
  const hasStarts = starts.length > 0;
  if (!proto && !hasStarts) return undefined;
  const out: PdsPrototype = {};
  if (hasStarts) out.starts = starts.slice();
  const device = deviceToPds(proto?.device, proto?.rotation);
  if (device) out.device = device;
  if (proto?.background) out.background = proto.background;
  return out;
}

function deviceToPds(
  device: DslPrototype["device"],
  rotation: DslPrototype["rotation"],
): PdsPrototype["device"] | undefined {
  if (device === undefined && rotation === undefined) return undefined;
  if (device === undefined || device === "none") {
    return rotation ? { kind: "none", rotation } : { kind: "none" };
  }
  if ("preset" in device) {
    return rotation
      ? { kind: "preset", preset: device.preset, rotation }
      : { kind: "preset", preset: device.preset };
  }
  return rotation
    ? { kind: "custom", size: device.size, rotation }
    : { kind: "custom", size: device.size };
}

// ============================================================================
// Plan: assembled PDS → MotionPlan wire contract
// ============================================================================

const WIRE_TRIGGERS: ReadonlySet<string> = new Set<WireTrigger>([
  "ON_CLICK",
  "ON_HOVER",
  "ON_PRESS",
  "ON_DRAG",
  "MOUSE_ENTER",
  "MOUSE_LEAVE",
  "MOUSE_UP",
  "MOUSE_DOWN",
  "AFTER_TIMEOUT",
  "ON_KEY_DOWN",
]);

const WIRE_KINDS: ReadonlySet<string> = new Set<WireTransitionKind>([
  "SMART_ANIMATE",
  "DISSOLVE",
  "MOVE_IN",
  "MOVE_OUT",
  "PUSH",
  "SLIDE_IN",
  "SLIDE_OUT",
  "SCROLL_ANIMATE",
  "INSTANT",
]);

const OVERLAY_POSITION_MAP: Record<NonNullable<PdsOverlayCfg["position"]>, WireOverlayPosition> = {
  center: "CENTER",
  top: "TOP_CENTER",
  bottom: "BOTTOM_CENTER",
  left: "CENTER",
  right: "CENTER",
  "top-left": "TOP_LEFT",
  "top-right": "TOP_RIGHT",
  "bottom-left": "BOTTOM_LEFT",
  "bottom-right": "BOTTOM_RIGHT",
  manual: "MANUAL",
};

const OVERFLOW_MAP: Record<
  NonNullable<MotionPdsNode["overflow"]>,
  NonNullable<WireFrame["overflow"]>
> = {
  none: "NONE",
  horizontal: "HORIZONTAL",
  vertical: "VERTICAL",
  both: "BOTH",
};

function normalizeTrigger(trigger: string): WireTrigger {
  return (WIRE_TRIGGERS.has(trigger) ? trigger : "ON_CLICK") as WireTrigger;
}

function normalizeKind(kind: string | undefined): WireTransitionKind {
  return (kind && WIRE_KINDS.has(kind) ? kind : "INSTANT") as WireTransitionKind;
}

/** Read-side CSS easing (+ spring params) → the wire easing string. */
function motionEasingToWire(
  easing: string | undefined,
  spring: AuthoredMotionSpec["spring"],
): string | undefined {
  if (spring) return `spring:${spring.mass},${spring.stiffness},${spring.damping}`;
  if (!easing) return undefined;
  const m = /^cubic-bezier\(([^)]+)\)$/.exec(easing);
  if (m && m[1]) {
    return `bezier:${m[1]
      .split(",")
      .map((s) => s.trim())
      .join(",")}`;
  }
  if (easing === "custom-spring") return undefined; // params missing → plugin default
  return easing;
}

function specToWire(ms: AuthoredMotionSpec): WireSpec {
  const navigation: WireNavigation =
    ms.navigation ??
    (ms.url !== undefined
      ? "URL"
      : ms.setVars !== undefined
        ? "SET_VAR"
        : ms.target !== undefined
          ? "NAVIGATE"
          : "NAVIGATE");

  const w: WireSpec = { trigger: normalizeTrigger(ms.trigger), navigation };

  if (NODE_NAVS.has(navigation)) {
    if (ms.target !== undefined) w.target = ms.target;
    w.kind = normalizeKind(ms.kind);
    if (ms.direction) w.direction = ms.direction;
    if (typeof ms.duration === "number") w.durationMs = ms.duration;
    const easing = motionEasingToWire(ms.easing, ms.spring);
    if (easing) w.easing = easing;
    if (ms.matchLayers !== undefined) w.matchLayers = ms.matchLayers;
    if (ms.preserveScroll !== undefined) w.preserveScroll = ms.preserveScroll;
    if (ms.resetState !== undefined) w.resetState = ms.resetState;
  } else if (navigation === "URL") {
    if (ms.url !== undefined) w.url = ms.url;
  } else if (navigation === "SET_VAR") {
    if (ms.setVars !== undefined) w.setVars = ms.setVars;
  }

  if (w.trigger === "AFTER_TIMEOUT" && typeof ms.timeout === "number") w.timeoutMs = ms.timeout;
  if (w.trigger === "ON_KEY_DOWN" && ms.keys) w.keys = ms.keys.slice();
  return w;
}

function overlayCfgToWire(cfg: PdsOverlayCfg): WireOverlay {
  const out: WireOverlay = {
    position: cfg.position ? OVERLAY_POSITION_MAP[cfg.position] : "CENTER",
  };
  if (cfg.at) out.at = cfg.at;
  if (cfg.backdrop) out.backdrop = cfg.backdrop;
  if (cfg.closeOnClickOutside !== undefined) out.closeOnClickOutside = cfg.closeOnClickOutside;
  return out;
}

function prototypeToWire(proto: PdsPrototype): WirePrototype {
  const out: WirePrototype = { starts: proto.starts ? proto.starts.slice() : [] };
  if (proto.device) {
    out.device = {
      kind: proto.device.kind,
      ...(proto.device.preset !== undefined ? { preset: proto.device.preset } : {}),
      ...(proto.device.size !== undefined ? { size: proto.device.size } : {}),
      rotation: proto.device.rotation === "landscape" ? "CW_90" : "NONE",
    };
  }
  if (proto.background) out.background = proto.background;
  return out;
}

/**
 * Lower an assembled PDS document to the `MotionPlan` wire contract consumed by
 * `apply-motion`. Walks every node for `motion` bindings and
 * `overflow`/`overlayCfg` frame config, plus the file-level `prototype`.
 */
export function buildMotionPlan(doc: MotionPdsDocument): MotionPlan {
  const bindings: WireBinding[] = [];
  const frames: WireFrame[] = [];

  for (const [el, base] of Object.entries(doc.nodes)) {
    const node = base as MotionPdsNode;

    const specs = node.motion as AuthoredMotionSpec[] | undefined;
    if (specs && specs.length > 0) {
      bindings.push({ sourceEl: el, specs: specs.map(specToWire) });
    }

    const hasOverflow = node.overflow !== undefined && node.overflow !== "none";
    if (hasOverflow || node.overlayCfg) {
      const frame: WireFrame = { el };
      if (node.overflow) frame.overflow = OVERFLOW_MAP[node.overflow];
      if (node.overlayCfg) frame.overlay = overlayCfgToWire(node.overlayCfg);
      frames.push(frame);
    }
  }

  const plan: MotionPlan = { bindings, frames };
  if (doc.prototype) {
    const wire = prototypeToWire(doc.prototype);
    if (wire.starts.length > 0 || wire.device || wire.background) plan.prototype = wire;
  }
  return plan;
}

/** True when the plan carries nothing to wire (skip the `apply-motion` round-trip). */
export function isEmptyMotionPlan(plan: MotionPlan): boolean {
  return (
    plan.bindings.length === 0 &&
    plan.frames.length === 0 &&
    (!plan.prototype ||
      (plan.prototype.starts.length === 0 &&
        !plan.prototype.device &&
        !plan.prototype.background))
  );
}
