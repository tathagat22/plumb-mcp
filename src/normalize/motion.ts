/**
 * Figma prototype reactions → `MotionSpec[]`.
 *
 * Figma models interaction as a reaction list on a node; the PDS models it as
 * a flat spec an agent can implement. This is the translation, including
 * easing curves, which Figma expresses four different ways.
 */

import type { FigmaReaction, FigmaTransition } from "../figma/types";
import type { MotionSpec } from "../pds";
import { round } from "../util/num";

/* ---------------------------------------------------------------------- */
/* Motion specs — Figma prototype reactions                                 */
/* ---------------------------------------------------------------------- */

function easingFromFigma(tr: FigmaTransition | undefined): string | undefined {
  if (!tr) return undefined;
  const cubic = tr.easing?.easingFunctionCubicBezier;
  if (Array.isArray(cubic) && cubic.length === 4) {
    return `cubic-bezier(${cubic.map((n) => round(n, 3)).join(",")})`;
  }
  const kind = tr.easing?.type ?? tr.easingType;
  if (!kind) return undefined;
  switch (kind) {
    case "EASE_IN":
      return "ease-in";
    case "EASE_OUT":
      return "ease-out";
    case "EASE_IN_AND_OUT":
    case "EASE_IN_OUT":
      return "ease-in-out";
    case "LINEAR":
      return "linear";
    default:
      return kind.toLowerCase().replace(/_/g, "-");
  }
}

export function motionFromReactions(reactions: FigmaReaction[] | undefined): MotionSpec[] | undefined {
  if (!reactions?.length) return undefined;
  const out: MotionSpec[] = [];
  for (const r of reactions) {
    const trigger = r.trigger?.type;
    if (!trigger) continue;
    const action = r.action;
    if (!action) continue;
    const tr = action.transition;
    const kind = tr?.type ?? action.type ?? "INSTANT";
    const spec: MotionSpec = { trigger, kind };
    // Figma stores duration in seconds on REST, sometimes in ms on plugin.
    // Both feel awkward; normalise to ms.
    if (typeof tr?.duration === "number") {
      const ms = tr.duration > 10 ? tr.duration : tr.duration * 1000;
      spec.duration = round(ms, 0);
    }
    const easing = easingFromFigma(tr);
    if (easing) spec.easing = easing;
    if (action.destinationId) spec.target = action.destinationId;
    // v0.10 Phase 3 — overlay positioning. Captured by plugin's
    // serializeReactions; REST tolerated but typically absent.
    const overlayPos = action.overlayRelativePosition;
    const overlayBg = action.overlayBackground;
    if (overlayPos || overlayBg) {
      const overlay: NonNullable<MotionSpec["overlay"]> = {};
      if (overlayPos && typeof overlayPos.x === "number" && typeof overlayPos.y === "number") {
        overlay.pos = { x: round(overlayPos.x), y: round(overlayPos.y) };
      }
      if (overlayBg && overlayBg.type !== "NONE") {
        const c = overlayBg.color;
        if (c) {
          // RGBA → CSS hex with alpha.
          const channel = (n: number): string =>
            Math.round(n * 255).toString(16).padStart(2, "0");
          let hex = `#${channel(c.r)}${channel(c.g)}${channel(c.b)}`;
          if (c.a !== undefined && c.a < 1) hex += channel(c.a);
          overlay.background = hex;
        }
      }
      if (overlay.pos || overlay.background) spec.overlay = overlay;
    }
    out.push(spec);
  }
  return out.length ? out : undefined;
}
