/**
 * The browser-side capture logic — Node-free on purpose.
 *
 * Split out from `capture.ts` (which imports the CDP harness) so it can be
 * bundled into a browser context — the playground runs the exact same capture
 * against an `<iframe>` document, and the CLI serialises `captureFn` over CDP.
 * One definition of "what we read off a rendered element", three call sites.
 */

/** The getComputedStyle keys the verify engine compares. Single source of truth. */
export const CAPTURED_STYLE_KEYS = [
  "backgroundColor",
  "color",
  "fontFamily",
  "fontSize",
  "fontWeight",
  "lineHeight",
  "paddingTop",
  "paddingRight",
  "paddingBottom",
  "paddingLeft",
  "gap",
  "flexDirection",
  "justifyContent",
  "alignItems",
  "borderRadius",
  "borderColor",
  "borderWidth",
  "opacity",
  "textDecorationLine",
  "boxShadow",
  "backdropFilter",
] as const;

/**
 * The captured shape — mirrors `RenderedElement` from `../verify` without
 * importing it (keeps this module dependency-free for clean browser bundling).
 */
export interface CapturedElement {
  el: string;
  box: { x: number; y: number; w: number; h: number };
  text: string;
  styles: Record<string, string>;
  /** The `data-plumb-asset` value, when the element rendered an exported asset. */
  asset?: string;
  /** True when the element actually rendered image/vector content (img/svg/bg-image),
   *  vs. being a redrawn styled div. Lets verify catch a missing/faked logo. */
  img?: boolean;
}

/**
 * The self-contained function injected into a rendered page (serialised via
 * `.toString()`) — over CDP for the CLI, or into an `<iframe>`'s own context
 * for the playground. No closure capture beyond its single argument, and it
 * reads from `globalThis` so it runs wherever it's injected. Returns
 * {@link CapturedElement}[] (shape-compatible with the verify engine's
 * `RenderedElement`).
 */
export const captureFn = function (selector: string): unknown {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const win = (globalThis as any).window ?? globalThis;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const doc = (globalThis as any).document ?? win.document;
  const out: unknown[] = [];
  const els = doc.querySelectorAll(selector);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  els.forEach((el: any) => {
    const id = el.getAttribute("data-plumb-id");
    if (!id) return;
    const rect = el.getBoundingClientRect();
    const cs = win.getComputedStyle(el);
    const styles: Record<string, string> = {
      backgroundColor: cs.backgroundColor,
      color: cs.color,
      fontFamily: cs.fontFamily,
      fontSize: cs.fontSize,
      fontWeight: cs.fontWeight,
      lineHeight: cs.lineHeight,
      paddingTop: cs.paddingTop,
      paddingRight: cs.paddingRight,
      paddingBottom: cs.paddingBottom,
      paddingLeft: cs.paddingLeft,
      gap: cs.gap,
      flexDirection: cs.flexDirection,
      justifyContent: cs.justifyContent,
      alignItems: cs.alignItems,
      borderRadius: cs.borderRadius,
      borderColor: cs.borderColor,
      borderWidth: cs.borderWidth,
      opacity: cs.opacity,
      textDecorationLine: cs.textDecorationLine ?? cs.textDecoration ?? "",
      boxShadow: cs.boxShadow ?? "",
      // backdrop-filter is still vendor-prefixed in some engines (Safari/older
      // Chrome). Read the standard prop first, fall back to the -webkit- alias
      // so a real glass effect isn't reported as "(unset)".
      backdropFilter: cs.backdropFilter || cs.webkitBackdropFilter || "",
    };
    // Asset fidelity: did this element render the real exported asset, or is it
    // an empty/redrawn box? Capture the data-plumb-asset tag + whether any
    // actual image/vector content is present.
    const tag = (el.tagName || "").toLowerCase();
    let img = tag === "img" || tag === "svg" || tag === "picture" || tag === "canvas";
    // A CSS gradient is NOT a real asset — only count a background that loads an
    // actual image (url(...)), so a redrawn gradient logo still reads as "no asset".
    if (!img && cs.backgroundImage && cs.backgroundImage.indexOf("url(") !== -1) img = true;
    if (!img && typeof el.querySelector === "function") img = !!el.querySelector("img,svg,picture,canvas");
    const assetAttr = el.getAttribute("data-plumb-asset");
    out.push({
      el: id,
      box: { x: rect.x, y: rect.y, w: rect.width, h: rect.height },
      text: el.textContent ?? "",
      styles,
      asset: assetAttr || undefined,
      img: img || undefined,
    });
  });
  return out;
};

/** Stringify the selector + capture function into a single page-eval expression. */
export function captureExpression(selector: string): string {
  const sel = JSON.stringify(selector);
  return `(${captureFn.toString()})(${sel})`;
}
