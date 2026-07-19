/**
 * HTML's Source Graph shape — docs/ROADMAP-v0.14-design-intelligence.md
 * §10 M9. Deliberately NOT `PdsNode`: that type is Figma-shaped (paint
 * types, component ids, token refs sharing semantics with Figma paints)
 * and forcing a `<div>` through it would be lossy and dishonest about what
 * it actually is. This is the first adapter to give the CIR a genuinely
 * different Source Graph shape to map from — the concrete test of "a
 * future adapter is additive" (§5).
 */

/** The computed-style facts a captured element carries. Superset of
 *  `render/captureFn.ts`'s `CAPTURED_STYLE_KEYS` (reused as the base list —
 *  it was already curated for "what matters for a design spec") plus the
 *  box-model / flex properties needed to reconstruct `PdsLayout`, which
 *  that list didn't need (verify only diffs already-known layout, it
 *  doesn't have to derive `flow` from `display`/`flex-direction` itself). */
export interface HtmlStyle {
  display?: string;
  flexDirection?: string;
  gap?: string;
  justifyContent?: string;
  alignItems?: string;
  flexWrap?: string;
  paddingTop?: string;
  paddingRight?: string;
  paddingBottom?: string;
  paddingLeft?: string;
  color?: string;
  backgroundColor?: string;
  backgroundImage?: string;
  fontFamily?: string;
  fontSize?: string;
  fontWeight?: string;
  borderRadius?: string;
  borderColor?: string;
  borderWidth?: string;
  boxShadow?: string;
  opacity?: string;
}

export interface HtmlSourceNode {
  /** Stable within one capture — a walk-order counter, not a DOM identity. */
  id: string;
  tag: string;
  box: { w: number; h: number };
  /** Viewport-absolute, in CSS px — converted to parent-relative during the
   *  CIR mapping step, mirroring how `normalize.ts` converts Figma's
   *  `absoluteBoundingBox` into parent-relative `pos`. */
  pos: { x: number; y: number };
  /** Own direct text — only set on leaf nodes with no element children. */
  text?: string;
  style: HtmlStyle;
  /** img/svg/picture/video/canvas, or a background-image that loads an
   *  actual url() — mirrors `captureFn.ts`'s existing `img` heuristic. */
  isImage: boolean;
  children: HtmlSourceNode[];
}
