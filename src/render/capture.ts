/**
 * Headless DOM capture — the "render" half of the fit/verify loop, CDP edition.
 *
 * The actual capture logic lives in the Node-free {@link captureFn} (see
 * `./captureFn.ts`) so the browser playground can reuse it. This module just
 * drives it over CDP: navigate a headless page, wait for hydration, eval the
 * serialised function, return the {@link RenderedElement} array the verify
 * engine expects.
 */
import { evaluate, navigate, type Browser } from "../cli/cdp";
import { captureExpression } from "./captureFn";
import type { RenderedElement } from "../verify";

export { CAPTURED_STYLE_KEYS, captureExpression, captureFn } from "./captureFn";

/**
 * Navigate to a page and capture its tagged elements. Waits two animation
 * frames after load so client-side route hydration (Vite + React Router and
 * friends) has settled before we read layout.
 */
export async function captureRendered(
  b: Browser,
  pageUrl: string,
  selector: string,
  waitMs: number,
): Promise<RenderedElement[]> {
  await navigate(b, pageUrl, waitMs);
  await evaluate<true>(
    b,
    "new Promise(r => requestAnimationFrame(() => requestAnimationFrame(() => r(true))))",
  );
  const result = await evaluate<RenderedElement[]>(b, captureExpression(selector));
  return Array.isArray(result) ? result : [];
}
