/**
 * The browser-side DOM walk — Node-free on purpose, same split as
 * `src/render/captureFn.ts`.
 *
 * Unlike `render/captureFn.ts`, which only reads elements already tagged
 * `data-plumb-id` (built for verifying a KNOWN build against a KNOWN
 * design), this walks the DOM unconditionally — there is no prior tagging
 * to key off when importing an arbitrary page. Every visible element
 * becomes a candidate `HtmlSourceNode`; non-visual tags and hidden/
 * zero-size elements are pruned. A hard node cap protects against
 * adversarial/huge pages, mirroring the lazy-load step-cap discipline
 * `src/brand/capture.ts` already uses.
 *
 * `.toString()`-serializing a function for injection has two real failure
 * modes, both caught by an actual live-Chrome smoke test (not unit tests —
 * hand-built fixtures never exercise `.toString()` at all):
 *  1. Any module-level `const`/helper the function body references is
 *     invisible to `.toString()` — it captures only the function's own
 *     source text, not surrounding closure scope. Everything the walk
 *     needs (skip-tag set, text-length cap) must be declared INSIDE the
 *     function body, which is why they're here and not hoisted to module
 *     scope the way `MAX_NODES` (a caller-facing default, passed as a
 *     param, never referenced from inside the injected body) is.
 *  2. A dev-only esbuild transform (`keepNames`, on under `tsx`, off under
 *     this project's actual `tsup` production build) wraps any function
 *     bound to a name — declaration OR `const x = () => {}` OR
 *     `const x = function(){}`, all of them — in a `__name(fn, "x")` call
 *     for stack-trace fidelity. That helper isn't included in a lone
 *     function's `.toString()` output, so it throws `ReferenceError:
 *     __name is not defined` in the browser regardless of naming style.
 *     `htmlCaptureExpression` below defends against this directly with a
 *     local no-op shim, rather than trying to out-guess which naming
 *     pattern a given bundler's transform does or doesn't target.
 */

const MAX_NODES = 3000;

/**
 * Self-contained function injected into a live page. No closure capture
 * beyond its own body and arguments; reads from `globalThis` so it runs
 * wherever CDP evaluates it.
 */
export const htmlCaptureFn = function (rootSelector: string | null, maxNodes: number): unknown {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const win = (globalThis as any).window ?? globalThis;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const doc = (globalThis as any).document ?? win.document;

  const skipTags = ["script", "style", "meta", "link", "head", "noscript", "template", "title", "iframe"];
  const maxTextChars = 500;
  let count = 0;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const isVisible = (cs: any, rect: any): boolean => {
    if (cs.display === "none" || cs.visibility === "hidden") return false;
    return rect.width > 0 || rect.height > 0;
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const walk = (el: any, id: string): unknown => {
    if (count >= maxNodes) return null;
    const tag = (el.tagName || "").toLowerCase();
    if (skipTags.indexOf(tag) !== -1) return null;

    const cs = win.getComputedStyle(el);
    const rect = el.getBoundingClientRect();
    if (!isVisible(cs, rect)) return null;

    count++;

    const style = {
      display: cs.display,
      flexDirection: cs.flexDirection,
      gap: cs.gap,
      justifyContent: cs.justifyContent,
      alignItems: cs.alignItems,
      flexWrap: cs.flexWrap,
      paddingTop: cs.paddingTop,
      paddingRight: cs.paddingRight,
      paddingBottom: cs.paddingBottom,
      paddingLeft: cs.paddingLeft,
      color: cs.color,
      backgroundColor: cs.backgroundColor,
      backgroundImage: cs.backgroundImage,
      fontFamily: cs.fontFamily,
      fontSize: cs.fontSize,
      fontWeight: cs.fontWeight,
      borderRadius: cs.borderRadius,
      borderColor: cs.borderColor,
      borderWidth: cs.borderWidth,
      boxShadow: cs.boxShadow,
      opacity: cs.opacity,
      textAlign: cs.textAlign,
      textDecorationLine: cs.textDecorationLine || cs.textDecoration,
      letterSpacing: cs.letterSpacing,
      lineHeight: cs.lineHeight,
      position: cs.position,
      // Standard prop first, -webkit- fallback — same reasoning as
      // render/captureFn.ts's own backdropFilter capture: still
      // vendor-prefixed in some engines.
      backdropFilter: cs.backdropFilter || cs.webkitBackdropFilter,
    };

    const children: unknown[] = [];
    const kids = el.children || [];
    for (let i = 0; i < kids.length && count < maxNodes; i++) {
      const childResult = walk(kids[i], `${id}.${i}`);
      if (childResult) children.push(childResult);
    }

    // NOT "picture" — a <picture> tag is a wrapper with no `.src` of its
    // own; the real image is a nested <img> child. Treating picture itself
    // as the leaf image (as an earlier version of this did) meant the JSX
    // renderer stopped there and never recursed into that real, properly-
    // sourced child at all — found live against vercel.com's actual
    // markup, not a hypothetical: several images silently had NO src
    // because their real <img> was being discarded one level up.
    let isImage = tag === "img" || tag === "svg" || tag === "video" || tag === "canvas";
    // `.src` (the DOM property, not the possibly-relative `src` ATTRIBUTE)
    // is already browser-resolved to an absolute URL — same for a
    // computed-style url(...), per the CSSOM spec. Neither needs manual
    // resolution against the page's base URL.
    let imageSrc: string | undefined;
    if (tag === "img" || tag === "video") imageSrc = el.src || undefined;
    // JS-library lazy-loading (as opposed to native `loading="lazy"`, which
    // still populates `.src` correctly): common libraries never set `src`
    // at all until the element scrolls into view, real URL sitting in a
    // `data-*` attribute instead. Found live against vercel.com — a real,
    // common pattern, not a hypothetical edge case.
    if (!imageSrc && (tag === "img" || tag === "video")) {
      imageSrc =
        el.getAttribute("data-src") ||
        el.getAttribute("data-lazy-src") ||
        el.getAttribute("data-original") ||
        undefined;
    }
    if (!imageSrc && style.backgroundImage) {
      const urlMatch = /url\((['"]?)(.*?)\1\)/.exec(style.backgroundImage);
      if (urlMatch?.[2]) imageSrc = urlMatch[2];
    }
    if (!isImage && imageSrc) isImage = true;

    // Own text only when this element has no element children — matches
    // how a design tool's TEXT leaf works, rather than decomposing every
    // inline span into its own node.
    let text: string | undefined;
    if (children.length === 0) {
      const raw = (el.textContent || "").trim();
      if (raw) text = raw.length > maxTextChars ? `${raw.slice(0, maxTextChars)}…` : raw;
    }

    return {
      id,
      tag,
      box: { w: rect.width, h: rect.height },
      pos: { x: rect.x, y: rect.y },
      text,
      style,
      isImage,
      imageSrc,
      children,
    };
  };

  const root = rootSelector ? doc.querySelector(rootSelector) : doc.body;
  return root ? walk(root, "0") : null;
};

/** Stringify the root selector + capture function into a page-eval
 *  expression. The `__name` shim is a no-op identity function defined in
 *  the SAME evaluated scope as the injected body — if a dev-mode
 *  transform's `__name(fn, "name")` calls survived `.toString()` (see the
 *  file docstring), they resolve harmlessly here instead of throwing.
 *  Under the real production build (no `keepNames`), this shim is simply
 *  unused. */
export function htmlCaptureExpression(rootSelector: string | null, maxNodes = MAX_NODES): string {
  const shim = "typeof __name==='undefined'&&(globalThis.__name=function(fn){return fn});";
  return `(function(){${shim}return (${htmlCaptureFn.toString()})(${JSON.stringify(rootSelector)}, ${maxNodes})})()`;
}
