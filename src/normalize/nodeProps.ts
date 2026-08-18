/**
 * Per-node property normalisation — the fields whose Figma representation
 * needs real translation before a renderer can use them: component property
 * overrides, inline vector paths, auto-layout child sizing, stroke alignment
 * and per-side widths, and mask mode.
 */

import type { FigmaNode } from "../figma/types";
import { round } from "../util/num";

/* ---------------------------------------------------------------------- */
/* Component property overrides                                             */
/* ---------------------------------------------------------------------- */

export function normalizeComponentProps(
  raw: FigmaNode["componentProperties"],
): Record<string, string | boolean | number> | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const out: Record<string, string | boolean | number> = {};
  for (const [key, entry] of Object.entries(raw)) {
    if (!entry || typeof entry !== "object") continue;
    const value = (entry as { value?: unknown }).value;
    if (typeof value !== "string" && typeof value !== "boolean" && typeof value !== "number") {
      continue;
    }
    // Strip Figma's `#id:idx` internal suffix — "Label#10:0" → "Label".
    const cleanKey = key.replace(/#[^#]*$/, "");
    out[cleanKey] = value;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/* ---------------------------------------------------------------------- */
/* Inline vector path                                                       */
/* ---------------------------------------------------------------------- */

/** Per-icon budget for the COMBINED `d` (all subpaths). Bigger icons still
 * ship via `plumb_assets`. */
const VECTOR_INLINE_MAX = 600;

export function inlineVectorPath(fn: FigmaNode): string | undefined {
  const geom = fn.fillGeometry;
  if (!Array.isArray(geom) || geom.length === 0) return undefined;
  // v0.10 Phase 3 — accept multi-subpath icons. Every production icon set
  // (Heroicons, Phosphor, Material) uses 2-3 subpaths for cutouts. We
  // concat the `d` strings with a space — SVG renders that as a single
  // path command sequence under one fill-rule.
  const ds: string[] = [];
  for (const entry of geom) {
    if (!entry) continue;
    const d = typeof entry.path === "string" ? entry.path : entry.data;
    if (typeof d === "string" && d.length > 0) ds.push(d);
  }
  if (ds.length === 0) return undefined;
  const combined = ds.join(" ");
  if (combined.length > VECTOR_INLINE_MAX) return undefined;
  return combined;
}

/* ---------------------------------------------------------------------- */
/* Auto-layout child sizing                                                 */
/* ---------------------------------------------------------------------- */

export function normalizeLayoutAlign(
  raw: string | undefined,
): "stretch" | "min" | "center" | "max" | undefined {
  switch (raw) {
    case "STRETCH":
      return "stretch";
    case "MIN":
      return "min";
    case "CENTER":
      return "center";
    case "MAX":
      return "max";
    default:
      // "INHERIT" and undefined → don't override the parent's align-items.
      return undefined;
  }
}

export function childSizing(
  fn: FigmaNode,
): { w?: "fill" | "hug"; h?: "fill" | "hug" } | undefined {
  const w = sizingValue(fn.layoutSizingHorizontal);
  const h = sizingValue(fn.layoutSizingVertical);
  if (!w && !h) return undefined;
  const out: { w?: "fill" | "hug"; h?: "fill" | "hug" } = {};
  if (w) out.w = w;
  if (h) out.h = h;
  return out;
}

function sizingValue(raw: string | undefined): "fill" | "hug" | undefined {
  // FIXED is the default and already implied by box.{w,h} — skip.
  if (raw === "FILL") return "fill";
  if (raw === "HUG") return "hug";
  return undefined;
}

/* ---------------------------------------------------------------------- */
/* Stroke alignment + per-side widths                                       */
/* ---------------------------------------------------------------------- */

export function normalizeStrokeAlign(
  raw: string | undefined,
): "inside" | "outside" | "center" | undefined {
  switch (raw) {
    case "INSIDE":
      return "inside";
    case "OUTSIDE":
      return "outside";
    case "CENTER":
      return "center";
    default:
      return undefined;
  }
}

export function perSideStrokeWidths(
  fn: FigmaNode,
  uniform: number | undefined,
): { t: number; r: number; b: number; l: number } | undefined {
  // REST ships `individualStrokeWeights: { top, right, bottom, left }`;
  // plugin ships them as flat `strokeTopWeight` / etc. Read either form.
  const isw = fn.individualStrokeWeights;
  const t = isw?.top ?? fn.strokeTopWeight;
  const r = isw?.right ?? fn.strokeRightWeight;
  const b = isw?.bottom ?? fn.strokeBottomWeight;
  const l = isw?.left ?? fn.strokeLeftWeight;
  if (t == null && r == null && b == null && l == null) return undefined;

  const tr = round(t ?? uniform ?? 0, 2);
  const rr = round(r ?? uniform ?? 0, 2);
  const br = round(b ?? uniform ?? 0, 2);
  const lr = round(l ?? uniform ?? 0, 2);
  // Only emit when at least one side actually differs — uniform borders
  // already covered by `strokeW`.
  if (tr === rr && rr === br && br === lr) return undefined;
  return { t: tr, r: rr, b: br, l: lr };
}

/* ---------------------------------------------------------------------- */
/* Mask mode                                                                */
/* ---------------------------------------------------------------------- */

export function normalizeMaskType(
  raw: string | undefined,
): "alpha" | "luminance" | "vector" | undefined {
  switch (raw) {
    case "ALPHA":
      return "alpha";
    case "LUMINANCE":
      return "luminance";
    case "VECTOR":
    case "GEOMETRY":
      return "vector";
    default:
      // Unknown / unspecified — fall through. The presence of `isMask` alone
      // is still enough for the renderer to know it's a mask.
      return undefined;
  }
}
