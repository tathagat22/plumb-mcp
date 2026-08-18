/**
 * Plan — the assembled PDS down to the `MotionPlan` wire contract.
 *
 * Walks the finished document and lowers every `node.motion`, `node.overflow`,
 * `node.overlayCfg`, and `doc.prototype` into the payload that rides
 * `apply-motion` to the plugin executor. Where compile.ts is authoring-shaped,
 * this is executor-shaped: anything the plugin cannot act on is dropped here
 * rather than sent and ignored.
 */

import type {
  AuthoredMotionSpec,
  MotionPdsDocument,
  MotionPdsNode,
  MotionPlan,
  PdsOverlayCfg,
  PdsPrototype,
  WireBinding,
  WireFrame,
  WireNavigation,
  WireOverlay,
  WireOverlayPosition,
  WirePrototype,
  WireSpec,
  WireTransitionKind,
  WireTrigger,
} from "./types";
import { NODE_NAVS } from "./compile";

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
