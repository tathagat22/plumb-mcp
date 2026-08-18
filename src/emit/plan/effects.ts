/**
 * Corner radius, effects, and vector paths.
 *
 * Radius has to resolve Figma's fully-rounded sentinel and per-corner tuples;
 * effects have to survive a round trip through the CSS `box-shadow` string the
 * PDS stores, which is why the parser here is more careful than it looks.
 */

import { hexToRgba01 } from "../../dsl/tokens";
import type { EmitEffect } from "../../bridge/protocol";
import type { Effect, PdsNode, TokenTable } from "../../pds";

/* ------------------------------------------------------------------------ */
/* Radius / effects / vector                                                 */
/* ------------------------------------------------------------------------ */

export function resolveRadius(
  radius: string | [number, number, number, number] | undefined,
  tokens: TokenTable,
): number | [number, number, number, number] | undefined {
  if (radius === undefined) return undefined;
  if (Array.isArray(radius)) return radius;
  if (radius.startsWith("$")) {
    const v = tokens.radius[radius];
    if (v === undefined) return undefined;
    return v === "full" ? 9999 : v;
  }
  const n = Number(radius);
  return Number.isFinite(n) ? n : undefined;
}

export function resolveEffects(node: PdsNode, tokens: TokenTable): EmitEffect[] | undefined {
  // Prefer the structured stack (ref `$eN` or literal Effect[]).
  let stack: Effect[] | undefined;
  if (Array.isArray(node.effects)) stack = node.effects;
  else if (typeof node.effects === "string") stack = tokens.effects?.[node.effects];

  if (stack && stack.length) {
    const out: EmitEffect[] = [];
    for (const e of stack) {
      const em = effectToEmit(e);
      if (em) out.push(em);
    }
    return out.length ? out : undefined;
  }

  // Fall back to the compact `shadow` field: `$sN` ref → CSS, or raw CSS.
  if (node.shadow) {
    const css = node.shadow.startsWith("$") ? tokens.shadow[node.shadow] : node.shadow;
    if (css) return parseBoxShadow(css);
  }
  return undefined;
}

export function effectToEmit(e: Effect): EmitEffect | undefined {
  if (e.type === "drop-shadow" || e.type === "inner-shadow") {
    const c = hexToRgba01(e.color);
    return {
      type: e.type === "drop-shadow" ? "DROP_SHADOW" : "INNER_SHADOW",
      color: { r: c.r, g: c.g, b: c.b, a: c.a ?? 1 },
      offset: { x: e.x, y: e.y },
      radius: e.blur,
      spread: e.spread,
    };
  }
  if (e.type === "layer-blur" || e.type === "background-blur") {
    return {
      type: e.type === "layer-blur" ? "LAYER_BLUR" : "BACKGROUND_BLUR",
      radius: e.radius,
    };
  }
  return undefined;
}

/** Parse a CSS box-shadow list (the `effectsToCss` format) into EmitEffects. */
export function parseBoxShadow(css: string): EmitEffect[] {
  const out: EmitEffect[] = [];
  for (const raw of splitShadows(css)) {
    const part = raw.trim();
    if (!part) continue;
    const inset = part.startsWith("inset");
    const body = inset ? part.slice(5).trim() : part;
    // "{ox}px {oy}px {blur}px {spread}px {hex}"
    const m = /^(-?[\d.]+)px\s+(-?[\d.]+)px\s+(-?[\d.]+)px\s+(-?[\d.]+)px\s+(#[0-9a-fA-F]+)$/.exec(body);
    if (!m) continue;
    const c = hexToRgba01(m[5]!);
    out.push({
      type: inset ? "INNER_SHADOW" : "DROP_SHADOW",
      color: { r: c.r, g: c.g, b: c.b, a: c.a ?? 1 },
      offset: { x: Number(m[1]), y: Number(m[2]) },
      radius: Number(m[3]),
      spread: Number(m[4]),
    });
  }
  return out;
}

/** Split a shadow list on commas that are NOT inside a color/paren group. */
export function splitShadows(css: string): string[] {
  return css.split(/,(?![^(]*\))/);
}

export function resolveVector(vector: string, tokens: TokenTable): string | undefined {
  if (vector.startsWith("$")) return tokens.vector?.[vector];
  return vector;
}
