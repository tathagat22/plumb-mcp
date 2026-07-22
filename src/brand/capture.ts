/**
 * Reference capture — screenshot a live website for the director's reference
 * board. Reuses Plumb's existing headless-Chrome-over-CDP harness (the same one
 * that powers the verify loop) — we just point it at a public URL instead of a
 * local dev server.
 */
import { findChrome } from "../cli/chrome";
import { launchBrowser, navigate, evaluate, type Browser } from "../cli/cdp";
import { assertNavigableUrl } from "../util/url";
import { extractRawPalette, type RawPalette } from "./palette";

export interface CaptureOpts {
  /** Viewport width — desktop reference default. */
  width?: number;
  /** Viewport height (the fold). */
  height?: number;
  /** Cap the full-page height so a 12,000px marketing page stays sane. */
  maxHeight?: number;
  /** Extra settle time (ms) after load for fonts / entrance animations. */
  settleMs?: number;
  /** Chrome binary override; auto-detected when omitted. */
  chromePath?: string;
}

export interface Capture {
  url: string;
  /** PNG bytes. */
  png: Buffer;
  width: number;
  height: number;
  /** The site's sampled computed-CSS palette (when extraction is on). */
  palette?: RawPalette;
}

const DEFAULTS: Required<Omit<CaptureOpts, "chromePath">> = {
  width: 1440,
  height: 900,
  maxHeight: 3200,
  settleMs: 1800,
};

/** Best-effort page-side step; swallows every error so a hostile page never fails the capture. */
async function safeEvaluate(b: Browser, expression: string): Promise<void> {
  try {
    await evaluate(b, expression);
  } catch {
    /* best-effort — a script error here must never abort the capture */
  }
}

/**
 * Click common cookie/consent-banner "accept" controls so they don't cover
 * the fold. Best-effort: matches buttons/links/role=button elements whose
 * id, class, or aria-label mentions "accept" (case-insensitive).
 */
async function dismissConsentOverlays(b: Browser): Promise<void> {
  await safeEvaluate(
    b,
    `(function () {
      try {
        var attrs = ["id", "class", "aria-label"];
        var tags = ["button", "a", '[role="button"]'];
        var selectors = [];
        for (var t = 0; t < tags.length; t++) {
          for (var a = 0; a < attrs.length; a++) {
            selectors.push(tags[t] + '[' + attrs[a] + '*="accept" i]');
          }
        }
        var seen = new Set();
        var els = document.querySelectorAll(selectors.join(","));
        for (var i = 0; i < els.length; i++) {
          var el = els[i];
          if (seen.has(el)) continue;
          seen.add(el);
          try { el.click(); } catch (e) { /* ignore */ }
        }
      } catch (e) { /* ignore — best-effort only */ }
      return true;
    })()`,
  );
}

/**
 * Scroll the page down in steps (re-checking scrollHeight each step, since
 * lazy-loaded content can grow the page as it goes) to trigger any
 * intersection-observer-gated images/sections, then scroll back to the top
 * before the shot.
 */
async function triggerLazyLoad(b: Browser): Promise<void> {
  await safeEvaluate(
    b,
    `(async function () {
      try {
        var step = Math.max(200, Math.floor(window.innerHeight * 0.8));
        var y = 0;
        var h = document.documentElement.scrollHeight;
        var guard = 0;
        while (y < h && guard < 60) {
          window.scrollTo(0, y);
          await new Promise(function (r) { setTimeout(r, 120); });
          y += step;
          h = document.documentElement.scrollHeight;
          guard++;
        }
        window.scrollTo(0, 0);
        await new Promise(function (r) { setTimeout(r, 150); });
      } catch (e) { /* ignore — best-effort only */ }
      return true;
    })()`,
  );
}

/** Wait for web fonts to finish loading so text doesn't shoot with fallback metrics. */
async function waitForFonts(b: Browser): Promise<void> {
  await safeEvaluate(
    b,
    `(async function () {
      try {
        if (document.fonts && document.fonts.ready) await document.fonts.ready;
      } catch (e) { /* ignore — best-effort only */ }
      return true;
    })()`,
  );
}

/** Screenshot one URL in an already-open browser (full page, height-capped). */
export async function captureInBrowser(b: Browser, url: string, opts: CaptureOpts = {}): Promise<Capture> {
  assertNavigableUrl(url);
  const o = { ...DEFAULTS, ...opts };
  // A fixed desktop viewport so every reference is graded at the same size.
  await b.send("Emulation.setDeviceMetricsOverride", {
    width: o.width,
    height: o.height,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await navigate(b, url, o.settleMs);

  // Best-effort hardening: clear consent overlays, trigger lazy content, and
  // make sure web fonts have settled before we measure or shoot anything.
  // Every step swallows its own errors — a hostile/odd page must never abort
  // the capture.
  await dismissConsentOverlays(b);
  await triggerLazyLoad(b);
  await waitForFonts(b);

  // Measure the real content height, then clamp it.
  let contentH = o.height;
  try {
    const metrics = await b.send<{ cssContentSize?: { height?: number } }>("Page.getLayoutMetrics");
    const h = metrics.cssContentSize?.height;
    if (typeof h === "number" && h > 0) contentH = Math.min(Math.ceil(h), o.maxHeight);
  } catch {
    /* fall back to viewport height */
  }

  // Sample the palette from the live page before we tear it down.
  let palette: RawPalette | undefined;
  try {
    palette = await extractRawPalette(b);
  } catch {
    /* palette is best-effort; a capture without one is still useful */
  }

  const shot = await b.send<{ data: string }>("Page.captureScreenshot", {
    format: "png",
    captureBeyondViewport: true,
    clip: { x: 0, y: 0, width: o.width, height: contentH, scale: 1 },
  });
  return { url, png: Buffer.from(shot.data, "base64"), width: o.width, height: contentH, palette };
}

/**
 * Launch a browser, screenshot every URL sequentially (one Chrome, many pages
 * reuses the tab), and return the captures. Failures are skipped, not fatal —
 * a reference board with 3 of 4 sites is still useful.
 */
export async function captureUrls(
  urls: string[],
  opts: CaptureOpts = {},
): Promise<{ captures: Capture[]; misses: { url: string; error: string }[] }> {
  const chromePath = opts.chromePath ?? findChrome();
  if (!chromePath) throw new Error("No Chrome found — set PLUMB_CHROME=/path/to/chrome.");

  const browser = await launchBrowser({ chromePath });
  const captures: Capture[] = [];
  const misses: { url: string; error: string }[] = [];
  try {
    for (const url of urls) {
      try {
        captures.push(await captureInBrowser(browser, url, opts));
      } catch (e) {
        misses.push({ url, error: e instanceof Error ? e.message : String(e) });
      }
    }
  } finally {
    await browser.close();
  }
  return { captures, misses };
}
