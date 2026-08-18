/// <reference types="@figma/plugin-typings" />

/**
 * Paints and effects — plan values onto Figma `Paint[]` / `Effect[]`.
 *
 * Mechanical by contract: the colour maths, gradient transforms, and degree
 * conversions all happened server-side. This assigns what it was given.
 */

import type { EmitEffect, EmitPaint, EmitWarning } from "./wire";
import type { AssetTables } from "./assets";

/* ------------------------------------------------------------------ */
/* Paints / effects                                                    */
/* ------------------------------------------------------------------ */

export function toPaint(p: EmitPaint, assets: AssetTables, warnings: EmitWarning[], key: string): Paint | null {
  if (p.type === "SOLID") {
    return { type: "SOLID", color: p.color, opacity: p.opacity } as SolidPaint;
  }
  if (p.type === "IMAGE") {
    const hash = assets.images.get(p.assetRef);
    if (!hash) {
      // An svg-backed image is realised as a child node, not a paint (see
      // materializeSvg). Skip the paint silently when the ref is a known svg.
      if (!assets.svgs.has(p.assetRef)) {
        warnings.push({ key, field: "fills", message: `image ref "${p.assetRef}" not hydrated` });
      }
      return null;
    }
    return {
      type: "IMAGE",
      imageHash: hash,
      scaleMode: p.scaleMode ?? "FILL",
      opacity: p.opacity,
    } as ImagePaint;
  }
  // Gradient — server pre-computed the transform (CCW, Figma-native).
  const transform = (p.transform ?? [
    [1, 0, 0],
    [0, 1, 0],
  ]) as unknown as Transform;
  return {
    type: p.type,
    gradientTransform: transform,
    gradientStops: p.stops.map((s) => ({ position: s.position, color: s.color })),
    opacity: p.opacity,
  } as GradientPaint;
}

export function toPaints(
  ps: EmitPaint[] | undefined,
  assets: AssetTables,
  warnings: EmitWarning[],
  key: string,
): Paint[] {
  if (!ps) return [];
  const out: Paint[] = [];
  for (const p of ps) {
    const paint = toPaint(p, assets, warnings, key);
    if (paint) out.push(paint);
  }
  return out;
}

export function toEffects(es: EmitEffect[] | undefined): Effect[] {
  if (!es) return [];
  const out: Effect[] = [];
  for (const e of es) {
    if (e.type === "DROP_SHADOW" || e.type === "INNER_SHADOW") {
      out.push({
        type: e.type,
        color: e.color,
        offset: e.offset,
        radius: e.radius,
        spread: e.spread ?? 0,
        visible: true,
        blendMode: "NORMAL",
      } as DropShadowEffect);
    } else {
      out.push({ type: e.type, radius: e.radius, visible: true } as BlurEffect);
    }
  }
  return out;
}
