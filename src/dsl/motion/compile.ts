/**
 * Compile — DSL `interactions` and `DslPrototype` down to PDS motion fields.
 *
 * `compileInteractions()` produces the `AuthoredMotionSpec[]` the block lowerer
 * assigns to `PdsNode.motion`; `compilePrototype()` produces the additive
 * `PdsDocument.prototype`. Everything here is authoring-shaped: it reads what a
 * designer wrote and emits what the spec stores.
 */

import type {
  DslEasing,
  DslInteraction,
  DslOverlayConfig,
  DslPrototype,
  DslTransition,
  DslTrigger,
} from "../schema";
import type {
  AuthoredMotionSpec,
  PdsOverlayCfg,
  PdsPrototype,
  WireDirection,
  WireNavigation,
  WireTransitionKind,
  WireTrigger,
} from "./types";

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

export const NODE_NAVS: ReadonlySet<WireNavigation> = new Set([
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
