/**
 * Colours and fills, PDS to Figma paints.
 *
 * Figma wants 0..1 float channels and its own gradient transform matrix; a PDS
 * carries hex strings, CSS angles, and a full fill stack. All of that
 * conversion happens HERE, server-side — the plugin executor is mechanical by
 * contract and does no colour maths of its own.
 */

import { hexToRgba01 } from "../../dsl/tokens";
import type { EmitPaint } from "../../bridge/protocol";
import type { Fill, GradientFill, ImageFill, PdsNode, SolidFill, TokenTable } from "../../pds";

/* ------------------------------------------------------------------------ */
/* Colour / fills                                                             */
/* ------------------------------------------------------------------------ */

/** Resolve a `$cN` ref (or a literal hex) to a hex string. */
export function resolveColor(ref: string, tokens: TokenTable): string | undefined {
  if (ref.startsWith("$")) return tokens.color[ref];
  if (ref.startsWith("#")) return ref;
  return undefined;
}

/** Hex → a SOLID EmitPaint, folding alpha into `opacity`. */
export function solidPaint(hex: string | undefined): EmitPaint | undefined {
  if (!hex) return undefined;
  const c = hexToRgba01(hex);
  const paint: EmitPaint = { type: "SOLID", color: { r: c.r, g: c.g, b: c.b } };
  const a = c.a ?? 1;
  if (a < 1) paint.opacity = a;
  return paint;
}

const SCALE_MODE: Record<string, NonNullable<Extract<EmitPaint, { type: "IMAGE" }>["scaleMode"]>> = {
  fill: "FILL",
  fit: "FIT",
  crop: "CROP",
  tile: "TILE",
  stretch: "FILL",
};

/** Resolve `node.fills` (ref `$fN` or literal) plus the compact `node.fill`. */
export function resolveFills(
  node: PdsNode,
  tokens: TokenTable,
  assetRefs: Set<string>,
): EmitPaint[] | undefined {
  const stack = resolveFillStack(node.fills, tokens);
  if (stack) {
    const out: EmitPaint[] = [];
    for (const f of stack) {
      const p = fillToPaint(f, assetRefs);
      if (p) out.push(p);
    }
    return out.length ? out : undefined;
  }
  // No structured stack — fall back to the compact `fill` ref (solids only;
  // "gradient"/"image" markers require the stack, handled above).
  if (node.fill && node.fill.startsWith("$c")) {
    const p = solidPaint(resolveColor(node.fill, tokens));
    return p ? [p] : undefined;
  }
  return undefined;
}

export function resolveFillStack(
  fills: Fill[] | string | undefined,
  tokens: TokenTable,
): Fill[] | undefined {
  if (fills === undefined) return undefined;
  if (typeof fills === "string") return tokens.fills?.[fills];
  return fills;
}

export function fillToPaint(f: Fill, assetRefs: Set<string>): EmitPaint | undefined {
  if (f.type === "color") return solidFillToPaint(f);
  if (f.type === "image") return imageFillToPaint(f, assetRefs);
  return gradientFillToPaint(f);
}

export function solidFillToPaint(f: SolidFill): EmitPaint | undefined {
  const c = hexToRgba01(f.color);
  const paint: EmitPaint = { type: "SOLID", color: { r: c.r, g: c.g, b: c.b } };
  const alpha = (c.a ?? 1) * (f.opacity ?? 1);
  if (alpha < 1) paint.opacity = alpha;
  if (f.var) paint.boundVar = f.var;
  return paint;
}

export function imageFillToPaint(f: ImageFill, assetRefs: Set<string>): EmitPaint | undefined {
  if (!f.assetId) return undefined;
  assetRefs.add(f.assetId);
  const paint: Extract<EmitPaint, { type: "IMAGE" }> = { type: "IMAGE", assetRef: f.assetId };
  if (f.scaleMode && SCALE_MODE[f.scaleMode]) paint.scaleMode = SCALE_MODE[f.scaleMode];
  if (f.opacity !== undefined && f.opacity < 1) paint.opacity = f.opacity;
  return paint;
}

type GradientPaintType = "GRADIENT_LINEAR" | "GRADIENT_RADIAL" | "GRADIENT_ANGULAR" | "GRADIENT_DIAMOND";

const GRADIENT_TYPE: Record<GradientFill["type"], GradientPaintType> = {
  "linear-gradient": "GRADIENT_LINEAR",
  "radial-gradient": "GRADIENT_RADIAL",
  "angular-gradient": "GRADIENT_ANGULAR",
  "diamond-gradient": "GRADIENT_DIAMOND",
};

export function gradientFillToPaint(f: GradientFill): EmitPaint | undefined {
  const type = GRADIENT_TYPE[f.type];
  const stops = f.stops.map((s) => {
    const c = hexToRgba01(s.color);
    return { position: s.at, color: { r: c.r, g: c.g, b: c.b, a: c.a ?? 1 } };
  });
  const paint: Extract<EmitPaint, { type: typeof type }> = { type, stops };
  if (f.type === "linear-gradient" && f.angle !== undefined) {
    paint.transform = linearGradientTransform(f.angle);
  }
  if (f.opacity !== undefined && f.opacity < 1) paint.opacity = f.opacity;
  return paint;
}

/**
 * CSS linear-gradient angle (0 = up, clockwise) → Figma `gradientTransform`
 * (the node→gradient-space affine). Inverse of `normalize/paint.ts`
 * `gradientAngle()`, so a write→read round-trip recovers the same angle.
 */
export function linearGradientTransform(angleDeg: number): [[number, number, number], [number, number, number]] {
  const phi = ((angleDeg - 90) * Math.PI) / 180;
  const dx = Math.cos(phi);
  const dy = Math.sin(phi);
  // Handles in 0..1 space: gradient axis centred, unit length.
  const h0x = 0.5 - dx * 0.5;
  const h0y = 0.5 - dy * 0.5;
  // T = inverse of [[dx,-dy,h0x],[dy,dx,h0y]] (rotation, det=1).
  return [
    [dx, dy, -(dx * h0x + dy * h0y)],
    [-dy, dx, dy * h0x - dx * h0y],
  ];
}
