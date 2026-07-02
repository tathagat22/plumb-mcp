/// <reference types="@figma/plugin-typings" />

/**
 * Plumb plugin — motion / prototype executor (main thread).
 *
 * The mechanical inverse of the read-side `serializeReactions`: given a
 * `MotionPlan` (built server-side by src/dsl/motion.ts `buildMotionPlan`) and
 * the emit `idMap` (authored PDS el → created Figma node id), this wires
 * prototype reactions, frame overflow / overlay presentation, and the page's
 * flow starting points + prototype background.
 *
 * Called by the emit engine LAST (after apply-design creates the nodes) so
 * every reaction destination already exists in `idMap`. `setReactionsAsync`
 * REPLACES all reactions, so one binding batches every spec for a source node.
 *
 * Self-contained: the plugin tsconfig cannot import from src/, so the wire
 * contract below mirrors src/dsl/motion.ts exactly. Keep the two in sync (the
 * integration agent lifts the canonical shapes into src/bridge/protocol.ts).
 */

/* ------------------------------------------------------------------ */
/* Wire contract (mirror of src/dsl/motion.ts / blueprint §2)          */
/* ------------------------------------------------------------------ */

type WireTrigger =
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

type WireNavigation =
  | "NAVIGATE"
  | "SWAP"
  | "OVERLAY"
  | "SCROLL_TO"
  | "BACK"
  | "CLOSE"
  | "URL"
  | "SET_VAR";

type WireTransitionKind =
  | "SMART_ANIMATE"
  | "DISSOLVE"
  | "MOVE_IN"
  | "MOVE_OUT"
  | "PUSH"
  | "SLIDE_IN"
  | "SLIDE_OUT"
  | "SCROLL_ANIMATE"
  | "INSTANT";

type WireDirection = "LEFT" | "RIGHT" | "TOP" | "BOTTOM";

interface WireSpec {
  trigger: WireTrigger;
  navigation: WireNavigation;
  target?: string;
  kind?: WireTransitionKind;
  direction?: WireDirection;
  durationMs?: number;
  easing?: string;
  matchLayers?: boolean;
  timeoutMs?: number;
  keys?: number[];
  url?: string;
  setVars?: Record<string, string | number | boolean>;
  preserveScroll?: boolean;
  resetState?: boolean;
}

interface WireBinding {
  sourceEl: string;
  specs: WireSpec[];
}

type WireOverlayPosition =
  | "CENTER"
  | "TOP_LEFT"
  | "TOP_CENTER"
  | "TOP_RIGHT"
  | "BOTTOM_LEFT"
  | "BOTTOM_CENTER"
  | "BOTTOM_RIGHT"
  | "MANUAL";

interface WireOverlay {
  position: WireOverlayPosition;
  at?: { x: number; y: number };
  backdrop?: string;
  closeOnClickOutside?: boolean;
}

interface WireFrame {
  el: string;
  overflow?: "NONE" | "HORIZONTAL" | "VERTICAL" | "BOTH";
  overlay?: WireOverlay;
}

interface WirePrototype {
  starts: { el: string; name: string }[];
  device?: {
    kind: "none" | "preset" | "custom";
    preset?: string;
    size?: { w: number; h: number };
    rotation?: "NONE" | "CW_90";
  };
  background?: string;
}

interface MotionPlan {
  bindings: WireBinding[];
  frames: WireFrame[];
  prototype?: WirePrototype;
}

interface MotionResult {
  wired: number;
  misses: string[];
  error: string | null;
}

/* ------------------------------------------------------------------ */
/* Easing / transition / trigger builders                              */
/* ------------------------------------------------------------------ */

const NAMED_EASING: Record<string, Easing["type"]> = {
  linear: "LINEAR",
  "ease-in": "EASE_IN",
  "ease-out": "EASE_OUT",
  "ease-in-out": "EASE_IN_AND_OUT",
  "ease-in-and-out": "EASE_IN_AND_OUT",
  "ease-in-back": "EASE_IN_BACK",
  "ease-out-back": "EASE_OUT_BACK",
  "ease-in-out-back": "EASE_IN_AND_OUT_BACK",
  "ease-in-and-out-back": "EASE_IN_AND_OUT_BACK",
  gentle: "GENTLE",
  quick: "QUICK",
  bouncy: "BOUNCY",
  slow: "SLOW",
};

function parseFloats(csv: string): number[] {
  return csv
    .split(",")
    .map((s) => parseFloat(s.trim()))
    .filter((n) => Number.isFinite(n));
}

/** Wire easing string → a Figma `Easing`. Defaults to EASE_OUT. */
function parseEasing(easing: string | undefined): Easing {
  if (!easing) return { type: "EASE_OUT" };
  if (easing.indexOf("bezier:") === 0) {
    const [x1, y1, x2, y2] = parseFloats(easing.slice(7));
    if ([x1, y1, x2, y2].every((n) => typeof n === "number")) {
      return {
        type: "CUSTOM_CUBIC_BEZIER",
        easingFunctionCubicBezier: { x1: x1!, y1: y1!, x2: x2!, y2: y2! },
      };
    }
    return { type: "EASE_OUT" };
  }
  if (easing.indexOf("spring:") === 0) {
    const [mass, stiffness, damping] = parseFloats(easing.slice(7));
    if ([mass, stiffness, damping].every((n) => typeof n === "number")) {
      return {
        type: "CUSTOM_SPRING",
        easingFunctionSpring: {
          mass: mass!,
          stiffness: stiffness!,
          damping: damping!,
          initialVelocity: 0,
        },
      };
    }
    return { type: "GENTLE" };
  }
  return { type: NAMED_EASING[easing] ?? "EASE_OUT" };
}

const SIMPLE_KINDS: ReadonlyArray<string> = ["DISSOLVE", "SMART_ANIMATE", "SCROLL_ANIMATE"];
const DIRECTIONAL_KINDS: ReadonlyArray<string> = [
  "MOVE_IN",
  "MOVE_OUT",
  "PUSH",
  "SLIDE_IN",
  "SLIDE_OUT",
];

/** Wire spec → a Figma `Transition` (or null for instant / non-node navs). */
function buildTransition(spec: WireSpec): Transition | null {
  const kind = spec.kind;
  if (!kind || kind === "INSTANT") return null;
  const easing = parseEasing(spec.easing);
  const duration = (typeof spec.durationMs === "number" ? spec.durationMs : 300) / 1000;
  if (SIMPLE_KINDS.indexOf(kind) !== -1) {
    return { type: kind as SimpleTransition["type"], easing, duration };
  }
  if (DIRECTIONAL_KINDS.indexOf(kind) !== -1) {
    return {
      type: kind as DirectionalTransition["type"],
      direction: spec.direction ?? "LEFT",
      matchLayers: spec.matchLayers ?? false,
      easing,
      duration,
    };
  }
  return null;
}

function buildTrigger(spec: WireSpec): Trigger {
  switch (spec.trigger) {
    case "ON_CLICK":
    case "ON_HOVER":
    case "ON_PRESS":
    case "ON_DRAG":
      return { type: spec.trigger };
    case "AFTER_TIMEOUT":
      return { type: "AFTER_TIMEOUT", timeout: (spec.timeoutMs ?? 0) / 1000 };
    case "MOUSE_UP":
    case "MOUSE_DOWN":
      return { type: spec.trigger, delay: 0 };
    case "MOUSE_ENTER":
    case "MOUSE_LEAVE":
      return { type: spec.trigger, delay: 0, deprecatedVersion: false };
    case "ON_KEY_DOWN":
      return { type: "ON_KEY_DOWN", device: "KEYBOARD", keyCodes: spec.keys ?? [] };
    default:
      return { type: "ON_CLICK" };
  }
}

function variableData(value: string | number | boolean): VariableData {
  if (typeof value === "boolean") return { type: "BOOLEAN", resolvedType: "BOOLEAN", value };
  if (typeof value === "number") return { type: "FLOAT", resolvedType: "FLOAT", value };
  return { type: "STRING", resolvedType: "STRING", value };
}

const NODE_NAVS: ReadonlyArray<string> = ["NAVIGATE", "SWAP", "OVERLAY", "SCROLL_TO"];

/**
 * Build the action list for one spec. `destId` is the resolved Figma id of the
 * navigation destination (null if unresolved). `overlayAt` is the manual
 * overlay position for OVERLAY navigations (the only overlay presentation the
 * plugin API lets us set — preset position / backdrop are read-only).
 */
function buildActions(
  spec: WireSpec,
  destId: string | null,
  overlayAt: { x: number; y: number } | undefined,
): Action[] {
  switch (spec.navigation) {
    case "BACK":
      return [{ type: "BACK" }];
    case "CLOSE":
      return [{ type: "CLOSE" }];
    case "URL":
      return spec.url ? [{ type: "URL", url: spec.url }] : [];
    case "SET_VAR": {
      const vars = spec.setVars ?? {};
      const actions: Action[] = [];
      for (const [variableId, value] of Object.entries(vars)) {
        actions.push({ type: "SET_VARIABLE", variableId, variableValue: variableData(value) });
      }
      return actions;
    }
    default: {
      // NAVIGATE / SWAP / OVERLAY / SCROLL_TO all resolve to a NODE action.
      if (NODE_NAVS.indexOf(spec.navigation) === -1) return [];
      // A NODE action with a null destination is rejected by setReactionsAsync;
      // drop it (like the URL case) so one unresolved target can't sink the pass.
      if (!destId) return [];
      const action: {
        type: "NODE";
        destinationId: string | null;
        navigation: Navigation;
        transition: Transition | null;
        overlayRelativePosition?: Vector;
        resetScrollPosition?: boolean;
        resetInteractiveComponents?: boolean;
      } = {
        type: "NODE",
        destinationId: destId,
        navigation: spec.navigation as Navigation,
        transition: buildTransition(spec),
      };
      if (spec.navigation === "OVERLAY" && overlayAt) {
        action.overlayRelativePosition = { x: overlayAt.x, y: overlayAt.y };
      }
      if (spec.preserveScroll !== undefined) action.resetScrollPosition = !spec.preserveScroll;
      if (spec.resetState) action.resetInteractiveComponents = true;
      return [action];
    }
  }
}

/* ------------------------------------------------------------------ */
/* Node resolution                                                     */
/* ------------------------------------------------------------------ */

async function nodeForEl(el: string, idMap: Map<string, string>): Promise<BaseNode | null> {
  const id = idMap.get(el);
  if (!id) return null;
  try {
    return await figma.getNodeByIdAsync(id);
  } catch {
    return null;
  }
}

function hexToRgba(hex: string): RGBA {
  let h = hex.trim().replace(/^#/, "");
  if (h.length === 3) {
    h = h[0]! + h[0]! + h[1]! + h[1]! + h[2]! + h[2]!;
  }
  const r = parseInt(h.slice(0, 2), 16) / 255;
  const g = parseInt(h.slice(2, 4), 16) / 255;
  const b = parseInt(h.slice(4, 6), 16) / 255;
  const a = h.length >= 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1;
  return {
    r: Number.isFinite(r) ? r : 0,
    g: Number.isFinite(g) ? g : 0,
    b: Number.isFinite(b) ? b : 0,
    a: Number.isFinite(a) ? a : 1,
  };
}

const OVERFLOW_DIR: Record<NonNullable<WireFrame["overflow"]>, OverflowDirection> = {
  NONE: "NONE",
  HORIZONTAL: "HORIZONTAL",
  VERTICAL: "VERTICAL",
  BOTH: "BOTH",
};

/* ------------------------------------------------------------------ */
/* Executor                                                            */
/* ------------------------------------------------------------------ */

/**
 * Wire an entire MotionPlan onto the created nodes.
 *
 * @param plan  the motion plan (bindings + frames + prototype)
 * @param idMap authored PDS el → created Figma node id (from EmitResult.ids)
 */
export async function wireMotion(
  plan: MotionPlan,
  idMap: Map<string, string>,
): Promise<MotionResult> {
  const misses: string[] = [];
  let wired = 0;

  // Destination overlay presentation, keyed by destination el — consumed when
  // building OVERLAY actions (manual position rides the action).
  const overlayByEl = new Map<string, WireOverlay>();
  for (const frame of plan.frames) {
    if (frame.overlay) overlayByEl.set(frame.el, frame.overlay);
  }

  try {
    // 1. Reactions on each source node.
    for (const binding of plan.bindings) {
      const source = await nodeForEl(binding.sourceEl, idMap);
      if (!source) {
        misses.push(`source el "${binding.sourceEl}" not in idMap`);
        continue;
      }
      if (!("setReactionsAsync" in source)) {
        misses.push(`node "${binding.sourceEl}" does not support reactions`);
        continue;
      }

      const reactions: Reaction[] = [];
      for (const spec of binding.specs) {
        let destId: string | null = null;
        if (spec.target !== undefined && NODE_NAVS.indexOf(spec.navigation) !== -1) {
          destId = idMap.get(spec.target) ?? null;
          if (!destId) misses.push(`target el "${spec.target}" not in idMap`);
        }
        const overlayAt =
          spec.navigation === "OVERLAY" && spec.target
            ? overlayAtFor(overlayByEl.get(spec.target))
            : undefined;
        const actions = buildActions(spec, destId, overlayAt);
        if (actions.length === 0) continue;
        reactions.push({ trigger: buildTrigger(spec), actions });
      }

      // NB: don't skip empty `reactions` — a binding that resolved to zero
      // actions (wire removed from the DSL) must still call setReactionsAsync([])
      // so a REUSED node on sync re-apply drops its stale interactions instead of
      // keeping last pass's wiring.
      // Per-binding guard: a single rejected reaction set must not abort the rest
      // of the bindings or the frame/prototype passes below.
      try {
        await (source as SceneNode & {
          setReactionsAsync(r: Reaction[]): Promise<void>;
        }).setReactionsAsync(reactions);
        wired += reactions.length;
      } catch (e) {
        misses.push(`setReactions failed on "${binding.sourceEl}": ${String(e)}`);
      }
    }

    // 2. Frame overflow + overlay presentation (best-effort — most overlay
    //    props are read-only in the plugin API).
    for (const frame of plan.frames) {
      const node = await nodeForEl(frame.el, idMap);
      if (!node) {
        misses.push(`frame el "${frame.el}" not in idMap`);
        continue;
      }
      if (frame.overflow && "overflowDirection" in node) {
        try {
          (node as FrameNode).overflowDirection = OVERFLOW_DIR[frame.overflow];
        } catch {
          misses.push(`overflow not settable on "${frame.el}"`);
        }
      }
      if (frame.overlay) applyOverlayPresentation(node, frame.overlay, frame.el, misses);
    }

    // 3. Prototype: flow starts, device, background (page-level).
    if (plan.prototype) applyPrototype(plan.prototype, idMap, misses);

    return { wired, misses, error: null };
  } catch (e) {
    return { wired, misses, error: e instanceof Error ? e.message : String(e) };
  }
}

function overlayAtFor(overlay: WireOverlay | undefined): { x: number; y: number } | undefined {
  if (overlay && overlay.position === "MANUAL" && overlay.at) return overlay.at;
  return undefined;
}

/**
 * Overlay preset position / backdrop / interaction live on read-only frame
 * properties (no setter exists in the plugin API). We attempt a guarded
 * runtime assignment and record a miss when the runtime rejects it; MANUAL
 * position is instead carried on the OVERLAY action (see buildActions).
 */
function applyOverlayPresentation(
  node: BaseNode,
  overlay: WireOverlay,
  el: string,
  misses: string[],
): void {
  const writable = node as unknown as {
    overlayPositionType?: OverlayPositionType;
    overlayBackground?: OverlayBackground;
    overlayBackgroundInteraction?: OverlayBackgroundInteraction;
  };
  try {
    if (overlay.position && overlay.position !== "MANUAL") {
      writable.overlayPositionType = overlay.position;
    }
    if (overlay.backdrop) {
      writable.overlayBackground = { type: "SOLID_COLOR", color: hexToRgba(overlay.backdrop) };
    }
    if (overlay.closeOnClickOutside !== undefined) {
      writable.overlayBackgroundInteraction = overlay.closeOnClickOutside
        ? "CLOSE_ON_CLICK_OUTSIDE"
        : "NONE";
    }
  } catch {
    misses.push(`overlay presentation not settable on "${el}" (read-only in plugin API)`);
  }
}

function applyPrototype(
  proto: WirePrototype,
  idMap: Map<string, string>,
  misses: string[],
): void {
  const page = figma.currentPage;

  if (proto.starts.length > 0) {
    const points: { nodeId: string; name: string }[] = [];
    for (const start of proto.starts) {
      const id = idMap.get(start.el);
      if (id) points.push({ nodeId: id, name: start.name });
      else misses.push(`flow start el "${start.el}" not in idMap`);
    }
    if (points.length > 0) {
      try {
        page.flowStartingPoints = points;
      } catch {
        misses.push("flow starting points not settable");
      }
    }
  }

  if (proto.background) {
    try {
      page.prototypeBackgrounds = [
        { type: "SOLID", color: rgbOf(hexToRgba(proto.background)) },
      ];
    } catch {
      misses.push("prototype background not settable");
    }
  }

  // Prototype device / rotation has no plugin-API setter — surface as a miss so
  // the caller knows it was requested but not applied.
  if (proto.device && proto.device.kind !== "none") {
    misses.push("prototype device is not settable via the plugin API");
  }
}

function rgbOf(rgba: RGBA): RGB {
  return { r: rgba.r, g: rgba.g, b: rgba.b };
}
