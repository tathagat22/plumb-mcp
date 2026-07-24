/**
 * Drives Plumb's existing headless-Chrome-over-CDP harness (the same one
 * `src/brand/capture.ts` uses for reference-site screenshots and
 * `src/render/capture.ts` uses for the verify loop) to walk a live page's
 * DOM and return an `HtmlSourceNode` tree.
 */
import { findChrome } from "../../cli/chrome";
import { launchBrowser, navigate, evaluate } from "../../cli/cdp";
import { assertNavigableUrl } from "../../util/url";
import { htmlCaptureExpression } from "./captureFn";
import type { HtmlSourceNode } from "./sourceGraph";

export interface CaptureHtmlOpts {
  /** CSS selector to root the walk at — omit to use `document.body`. */
  rootSelector?: string;
  /** Extra settle time (ms) after load, for fonts/animations/hydration. */
  settleMs?: number;
  /** Hard cap on nodes walked — protects against adversarial/huge pages. */
  maxNodes?: number;
  /** Viewport size — affects what's "visible" and initial layout. */
  width?: number;
  height?: number;
  chromePath?: string;
}

const DEFAULT_SETTLE_MS = 1200;
const DEFAULT_WIDTH = 1440;
const DEFAULT_HEIGHT = 900;

/** Navigate to `url` and capture its visible DOM as an `HtmlSourceNode` tree.
 *  Returns `null` if the root selector matched nothing (or the page has no
 *  visible content) — never throws for "empty," only for real navigation/
 *  browser failures. */
export async function captureHtmlSource(url: string, opts: CaptureHtmlOpts = {}): Promise<HtmlSourceNode | null> {
  assertNavigableUrl(url);
  const chromePath = opts.chromePath ?? findChrome();
  if (!chromePath) throw new Error("No Chrome found — set PLUMB_CHROME=/path/to/chrome.");

  const browser = await launchBrowser({
    chromePath,
    extraFlags: [`--window-size=${opts.width ?? DEFAULT_WIDTH},${opts.height ?? DEFAULT_HEIGHT}`],
  });
  try {
    await navigate(browser, url, opts.settleMs ?? DEFAULT_SETTLE_MS);
    const result = await evaluate<HtmlSourceNode | null>(
      browser,
      htmlCaptureExpression(opts.rootSelector ?? null, opts.maxNodes),
    );
    return result ?? null;
  } finally {
    await browser.close();
  }
}

export interface CaptureViewport {
  /** e.g. "mobile" / "tablet" / "desktop" — echoed back as the result key. */
  label: string;
  width: number;
  height: number;
}

/** Same capture as {@link captureHtmlSource}, at N viewport sizes against
 *  ONE browser/page — real responsive layouts (a hamburger nav that only
 *  exists under 768px, a grid that collapses to one column) are otherwise
 *  invisible to a single fixed-size capture. Reuses `Emulation.
 *  setDeviceMetricsOverride` (the same live-resize CDP call
 *  `src/brand/capture.ts`'s `captureInBrowser` already uses) instead of
 *  relaunching Chrome per viewport — N `--window-size` cold starts would
 *  cost N Chrome launches for one page. */
export async function captureHtmlSourceAtViewports(
  url: string,
  viewports: CaptureViewport[],
  opts: Omit<CaptureHtmlOpts, "width" | "height"> = {},
): Promise<{ label: string; root: HtmlSourceNode | null }[]> {
  assertNavigableUrl(url);
  const chromePath = opts.chromePath ?? findChrome();
  if (!chromePath) throw new Error("No Chrome found — set PLUMB_CHROME=/path/to/chrome.");

  const browser = await launchBrowser({ chromePath });
  try {
    const results: { label: string; root: HtmlSourceNode | null }[] = [];
    for (const vp of viewports) {
      await browser.send("Emulation.setDeviceMetricsOverride", {
        width: vp.width,
        height: vp.height,
        deviceScaleFactor: 1,
        mobile: vp.width < 768,
      });
      await navigate(browser, url, opts.settleMs ?? DEFAULT_SETTLE_MS);
      const result = await evaluate<HtmlSourceNode | null>(
        browser,
        htmlCaptureExpression(opts.rootSelector ?? null, opts.maxNodes),
      );
      results.push({ label: vp.label, root: result ?? null });
    }
    return results;
  } finally {
    await browser.close();
  }
}
