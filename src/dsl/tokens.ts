/**
 * Brand → TokenTable lowering.
 *
 * Wraps the EXISTING `TokenInterner` (src/normalize/tokens.ts) so the tokens a
 * compiled DesignDoc emits use the identical `$cN / $tN / $rN / $sN` (+ compound
 * `$lN / $fN`) encodings that `normalize()` produces from a real Figma file.
 * That byte-shape identity is the symmetry payoff: verify/fit never need to know
 * whether a PDS came from Figma or from the DSL.
 *
 * Everything the compiler needs to turn a semantic DSL colour / type / radius /
 * shadow / layout reference into a PDS token ref lives here. Brand `@role`
 * lookups, spacing/radius/shadow scale-key resolution, and hex→rgba(0..1)
 * conversion (the interner speaks Figma paints, not CSS hex) are all resolved in
 * this one place.
 */

import { TokenInterner } from "../normalize/tokens";
import { round } from "../util/num";
import type { FigmaEffect, FigmaTypeStyle, RgbaColor } from "../figma/types";
import type { Effect, Fill, GradientFill, PdsLayout } from "../pds";
import type {
  Brand,
  Color,
  Gradient,
  PadSpec,
  RadiusTok,
  ResolvedTypeStyle,
  ShadowSpec,
  ShadowTok,
  Space,
  TypeStyle,
} from "./schema";

const DEFAULT_FONT = "Inter";

/**
 * The tracking a designer would apply when the brand didn't specify one.
 * Values are px (absolute, size-proportional): tighten hard as type grows,
 * open up uppercase labels, leave body alone. This is what separates a
 * designed type system from Figma's flat 0-tracking default.
 */
function autoTracking(size: number, transform?: "upper" | "lower" | "none"): number {
  if (transform === "upper") return round(size * 0.09, 2); // labels breathe: +0.09em
  if (size >= 44) return round(size * -0.03, 2); //  display: −0.03em
  if (size >= 30) return round(size * -0.022, 2); // h1 / h2
  if (size >= 22) return round(size * -0.014, 2); // h3 / subhead
  if (size >= 19) return round(size * -0.008, 2); // large body / lead
  return 0; //                                       body / small
}

/** Paint markers the compact `node.fill` field carries for non-solid fills. */
export type FillPlan = {
  /** Compact dominant fill: `$cN` for solids, `"gradient"` / `"image"`. */
  fill?: string;
  /** Full stack ref (`$fN`) when the fill is a gradient or image. */
  fills?: string;
  /** Inbound asset key mirrored to `node.assetId` for image fills. */
  assetId?: string;
};

const GRADIENT_KIND: Record<Gradient["kind"], GradientFill["type"]> = {
  linear: "linear-gradient",
  radial: "radial-gradient",
  angular: "angular-gradient",
  diamond: "diamond-gradient",
};

/** `#rgb` / `#rgba` / `#rrggbb` / `#rrggbbaa` → Figma rgba (0..1 channels). */
export function hexToRgba01(hex: string): RgbaColor {
  let h = hex.trim().replace(/^#/, "");
  if (h.length === 3 || h.length === 4) {
    h = h
      .split("")
      .map((c) => c + c)
      .join("");
  }
  const int = (a: number, b: number): number => {
    const v = parseInt(h.slice(a, b), 16);
    return Number.isFinite(v) ? v / 255 : 0;
  };
  const a = h.length >= 8 ? int(6, 8) : 1;
  return { r: int(0, 2), g: int(2, 4), b: int(4, 6), a };
}

export class TokenCtx {
  readonly interner = new TokenInterner();

  constructor(private readonly brand: Brand) {}

  /** Final token table — identical shape to `normalize()`'s output. */
  table() {
    return this.interner.table();
  }

  // -- Colour ---------------------------------------------------------------

  /** Resolve a `@role` ref / hex / Gradient down to a hex string or Gradient. */
  resolveColor(c: Color): string | Gradient {
    if (typeof c !== "string") return c;
    if (c.startsWith("@")) {
      const role = c.slice(1);
      const v = this.brand.colors[role];
      // Guard against self-reference and missing roles → visible fallback.
      if (v === undefined || v === c) return "#000000";
      return this.resolveColor(v);
    }
    return c;
  }

  /** Intern a solid hex → `$cN`. */
  solidRef(hex: string): string {
    return this.interner.internColor([{ type: "SOLID", color: hexToRgba01(hex) }])!;
  }

  /** Plan the `fill` / `fills` fields for any DSL colour (solid or gradient). */
  fillFor(c: Color): FillPlan {
    const resolved = this.resolveColor(c);
    if (typeof resolved === "string") return { fill: this.solidRef(resolved) };
    const grad = this.gradientFill(resolved);
    return { fill: "gradient", fills: this.interner.internFills([grad]) };
  }

  /** Plan the `fill` / `fills` fields for an image paint. */
  imageFillFor(
    assetId: string,
    scaleMode?: "fill" | "fit" | "stretch" | "crop" | "tile",
  ): FillPlan {
    const stack: Fill[] = [{ type: "image", assetId, scaleMode: scaleMode ?? "fill" }];
    return { fill: "image", fills: this.interner.internFills(stack), assetId };
  }

  private gradientFill(g: Gradient): GradientFill {
    const out: GradientFill = {
      type: GRADIENT_KIND[g.kind],
      stops: g.stops.map((s) => {
        const c = this.resolveColor(s.color);
        return { at: round(s.at, 4), color: typeof c === "string" ? c : "#000000" };
      }),
    };
    if (g.kind === "linear" && g.angle !== undefined) out.angle = round(g.angle, 1);
    return out;
  }

  // -- Type -----------------------------------------------------------------

  /**
   * Resolve a type reference (a `Brand.type` name, an inline TypeStyle, or
   * nothing → body) into the `$tN` ref plus the derived colour ref, decoration,
   * and the concrete metrics a text measurer needs.
   */
  typeFor(
    style: string | TypeStyle | undefined,
    fallbackColor?: Color,
  ): {
    ref: string | undefined;
    /** @deprecated solid-flattened colour ref — kept for callers that can't
     *  carry a gradient fill. Prefer `fillPlan` (carries gradients whole). */
    color: string | undefined;
    /** Full fill plan (solid `$cN` OR gradient `$fN` stack) for the style's
     *  resolved colour — lets Text carry a gradient fill instead of being
     *  flattened to its first stop. */
    fillPlan: FillPlan | undefined;
    decoration?: "underline" | "line-through";
    rts: ResolvedTypeStyle;
  } {
    const ts = this.resolveTypeStyle(style);
    const family = this.family(ts.font);
    // Tracking is the loudest "designed vs. defaulted" tell. When the brand
    // doesn't specify it, a real designer still applies it: tight negative at
    // display sizes, open positive on uppercase labels, neutral for body.
    const tracking = ts.tracking ?? autoTracking(ts.size, ts.transform);
    const fig: FigmaTypeStyle = {
      fontFamily: family,
      fontWeight: ts.weight ?? 400,
      fontSize: ts.size,
      lineHeightPx: ts.line ? round(ts.size * ts.line, 2) : undefined,
      letterSpacing: tracking,
    };
    const ref = this.interner.internText(fig);
    const colorTok = ts.color ?? fallbackColor;
    const color = colorTok !== undefined ? this.colorRef(colorTok) : undefined;
    const fillPlan = colorTok !== undefined ? this.fillFor(colorTok) : undefined;
    const rts: ResolvedTypeStyle = {
      size: ts.size,
      weight: ts.weight ?? 400,
      line: ts.line ?? 1.3,
      tracking,
      family,
    };
    return {
      ref,
      color,
      fillPlan,
      decoration: ts.decoration,
      rts,
    };
  }

  /** Resolve any colour to a solid `$cN` ref, flattening gradients to stop 0. */
  colorRef(c: Color): string {
    const resolved = this.resolveColor(c);
    if (typeof resolved === "string") return this.solidRef(resolved);
    const first = resolved.stops[0];
    const c0 = first ? this.resolveColor(first.color) : "#000000";
    return this.solidRef(typeof c0 === "string" ? c0 : "#000000");
  }

  private resolveTypeStyle(style: string | TypeStyle | undefined): TypeStyle {
    if (style && typeof style === "object") return style;
    if (typeof style === "string") {
      const named = this.brand.type[style];
      if (named) return named;
    }
    return this.brand.type.body ?? { size: 16, weight: 400, line: 1.5, font: "body" };
  }

  private family(font: TypeStyle["font"]): string {
    const f = this.brand.fonts;
    if (font === "heading") return f?.heading ?? f?.body ?? DEFAULT_FONT;
    if (font === "mono") return f?.mono ?? "Menlo";
    if (font === "body" || font === undefined) return f?.body ?? DEFAULT_FONT;
    return font; // literal family name
  }

  // -- Radius ---------------------------------------------------------------

  /** Resolve a radius token (px / "full" / scale key) → `$rN`. */
  radiusRef(tok: RadiusTok | undefined): string | undefined {
    if (tok === undefined) return undefined;
    if (tok === "full") return this.interner.internRadius("full");
    if (typeof tok === "number") return this.interner.internRadius(tok);
    // Scale key.
    const v = this.brand.radius?.[tok];
    if (v === undefined) return undefined;
    return this.interner.internRadius(v);
  }

  // -- Shadow ---------------------------------------------------------------

  /**
   * Resolve a shadow token. Scale keys intern to `$sN` (deduped); a raw CSS
   * box-shadow string is returned verbatim (valid for the compact `node.shadow`
   * field, just not deduped).
   */
  shadowRef(tok: ShadowTok | undefined): string | undefined {
    if (tok === undefined) return undefined;
    const spec = this.brand.shadow?.[tok] ?? DEFAULT_SHADOWS[tok];
    if (spec) return this.interner.internShadow([shadowToEffect(spec)]);
    return tok; // raw CSS box-shadow string
  }

  /**
   * Resolve a shadow scale-key token to a structured PDS `Effect[]` (rather
   * than the compact CSS-string `shadow` field) — needed when a `blur`
   * effect must ride in the same `node.effects` stack as the drop-shadow. A
   * raw CSS box-shadow string can't be losslessly re-parsed here, so it
   * returns `undefined` (caller drops the shadow in favor of the blur).
   */
  shadowEffects(tok: ShadowTok | undefined): Effect[] | undefined {
    if (tok === undefined) return undefined;
    const spec = this.brand.shadow?.[tok] ?? DEFAULT_SHADOWS[tok];
    if (!spec) return undefined;
    return [
      {
        type: spec.inset ? "inner-shadow" : "drop-shadow",
        x: spec.x,
        y: spec.y,
        blur: spec.blur,
        spread: spec.spread,
        color: spec.color,
      },
    ];
  }

  // -- Layout ---------------------------------------------------------------

  /** Intern a fully-built PdsLayout → `$lN` (deduped across every container). */
  layoutRef(layout: PdsLayout): string | undefined {
    return this.interner.internLayout(layout);
  }

  // -- Spacing --------------------------------------------------------------

  /** Resolve a spacing token (px number or scale key) → px number. */
  space(s: Space | undefined, dflt = 0): number {
    if (s === undefined) return dflt;
    if (typeof s === "number") return s;
    const v = this.brand.spacing?.[s];
    return v ?? dflt;
  }

  /** Normalise a PadSpec into PDS `[top, right, bottom, left]`. */
  pad(p: PadSpec | undefined): [number, number, number, number] {
    if (p === undefined) return [0, 0, 0, 0];
    if (!Array.isArray(p)) {
      const v = this.space(p);
      return [v, v, v, v];
    }
    if (p.length === 2) {
      const [v, h] = p;
      const vv = this.space(v);
      const hh = this.space(h);
      return [vv, hh, vv, hh];
    }
    const [t, r, b, l] = p;
    return [this.space(t), this.space(r), this.space(b), this.space(l)];
  }
}

/**
 * A built-in ambient-elevation scale, used whenever a design authors a shadow
 * scale-key (`sm`/`md`/`lg`/`xl`) but the brand didn't define a `shadow` scale
 * of its own — the common case for a synthesized brand (e.g. plumb_studio),
 * which extracts colour + type but not elevation. Without this, `shadow:"lg"`
 * used to fall through to the literal string `"lg"` and silently drop, leaving
 * cards flat/templated. Tuned soft + dark-UI-friendly.
 */
const DEFAULT_SHADOWS: Record<string, ShadowSpec> = {
  sm: { x: 0, y: 1, blur: 2, spread: 0, color: "#00000026" },
  md: { x: 0, y: 4, blur: 12, spread: 0, color: "#00000033" },
  lg: { x: 0, y: 12, blur: 32, spread: -4, color: "#00000040" },
  xl: { x: 0, y: 24, blur: 56, spread: -8, color: "#0000004d" },
};

function shadowToEffect(s: ShadowSpec): FigmaEffect {
  return {
    type: s.inset ? "INNER_SHADOW" : "DROP_SHADOW",
    color: hexToRgba01(s.color),
    offset: { x: s.x, y: s.y },
    radius: s.blur,
    spread: s.spread,
  };
}
