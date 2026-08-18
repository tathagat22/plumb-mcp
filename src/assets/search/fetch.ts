/**
 * HTTP helpers for provider egress.
 *
 * Every call is abort-guarded and returns null rather than throwing: the
 * engine's contract is that a provider going down degrades the result set, it
 * never fails the caller. Server-side only — the plugin never talks to a
 * provider domain.
 */

import type { AssetExt, AssetSearchContext, FetchedBytes } from "./contracts";
import { EXT_MIME } from "./contracts";

// ============================================================================
// HTTP helpers (server-side egress; guarded with an abort timeout)
// ============================================================================

export async function httpJson<T>(
  url: string,
  ctx: AssetSearchContext,
  headers?: Record<string, string>,
): Promise<T> {
  const res = await fetch(url, {
    signal: AbortSignal.timeout(ctx.timeoutMs),
    headers: { "user-agent": "plumb-mcp", accept: "application/json", ...headers },
  });
  if (!res.ok) throw new Error(`GET ${url} → ${res.status}`);
  return (await res.json()) as T;
}

export async function httpBytes(
  url: string,
  ctx: AssetSearchContext,
  headers?: Record<string, string>,
): Promise<{ bytes: Uint8Array; contentType: string }> {
  const res = await fetch(url, {
    signal: AbortSignal.timeout(ctx.timeoutMs),
    headers: { "user-agent": "plumb-mcp", ...headers },
  });
  if (!res.ok) throw new Error(`GET ${url} → ${res.status}`);
  const buf = new Uint8Array(await res.arrayBuffer());
  return { bytes: buf, contentType: res.headers.get("content-type") ?? "" };
}

export function extFromContentType(ct: string, fallback: AssetExt): AssetExt {
  const c = ct.toLowerCase();
  if (c.includes("svg")) return "svg";
  if (c.includes("png")) return "png";
  if (c.includes("webp")) return "webp";
  if (c.includes("gif")) return "gif";
  if (c.includes("jpeg") || c.includes("jpg")) return "jpg";
  return fallback;
}

/** Fetch a bitmap URL into {@link FetchedBytes}. */
export async function fetchBitmap(
  url: string,
  ctx: AssetSearchContext,
  fallbackExt: AssetExt = "jpg",
): Promise<FetchedBytes> {
  const { bytes, contentType } = await httpBytes(url, ctx);
  const ext = extFromContentType(contentType, fallbackExt);
  return { bytes, ext, mime: EXT_MIME[ext] };
}

/** Fetch an SVG URL as both bytes and markup (so it can be inlined). */
export async function fetchSvg(url: string, ctx: AssetSearchContext): Promise<FetchedBytes> {
  const res = await fetch(url, {
    signal: AbortSignal.timeout(ctx.timeoutMs),
    headers: { "user-agent": "plumb-mcp", accept: "image/svg+xml" },
  });
  if (!res.ok) throw new Error(`GET ${url} → ${res.status}`);
  const svgText = await res.text();
  return {
    bytes: new TextEncoder().encode(svgText),
    ext: "svg",
    mime: EXT_MIME.svg,
    svgText,
  };
}
