/**
 * Fetch helpers shared by every asset provider (blueprint's `http.ts`).
 * Mirrors the style of `src/figma/rest.ts`: plain `fetch`, explicit error
 * messages, no dependency beyond Node's built-in `fetch` (Node >=20, see
 * package.json `engines`). Providers MUST NOT let a network failure throw
 * past `search()`/`fetch()` uncaught — see each provider's own try/catch —
 * these helpers just centralize timeout/UA/retry so that's easy to do.
 */

export const DEFAULT_TIMEOUT_MS = 8000;
export const USER_AGENT = "plumb-mcp-asset-engine/1.0 (+https://github.com/tathagat22/plumb-mcp)";

/** Per-call context every provider threads through search()/fetch(). */
export interface HttpCtx {
  timeoutMs?: number;
  signal?: AbortSignal;
  headers?: Record<string, string>;
}

function linkedAbort(ctx?: HttpCtx): { signal: AbortSignal; cancel: () => void } {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ctx?.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  if (ctx?.signal) {
    if (ctx.signal.aborted) controller.abort();
    else ctx.signal.addEventListener("abort", () => controller.abort(), { once: true });
  }
  return {
    signal: controller.signal,
    cancel: () => clearTimeout(timer),
  };
}

function mergedHeaders(ctx: HttpCtx | undefined, extra?: RequestInit["headers"]): Record<string, string> {
  return {
    "User-Agent": USER_AGENT,
    ...(ctx?.headers ?? {}),
    ...((extra as Record<string, string>) ?? {}),
  };
}

/** Retry on 429/5xx with a short linear backoff; everything else fails fast. */
async function withRetry<T>(fn: () => Promise<T>, attempts = 2): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i <= attempts; i++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      const retryable = e instanceof RetryableHttpError;
      if (!retryable || i === attempts) break;
      await new Promise((r) => setTimeout(r, 200 * (i + 1)));
    }
  }
  throw lastErr;
}

class RetryableHttpError extends Error {}

async function doFetch(url: string, ctx: HttpCtx | undefined, init: RequestInit): Promise<Response> {
  const { signal, cancel } = linkedAbort(ctx);
  try {
    const res = await fetch(url, { ...init, signal, headers: mergedHeaders(ctx, init.headers) });
    if (!res.ok) {
      const msg = `HTTP ${res.status} for ${url}`;
      if (res.status === 429 || res.status >= 500) throw new RetryableHttpError(msg);
      throw new Error(msg);
    }
    return res;
  } finally {
    cancel();
  }
}

export async function fetchJson<T>(url: string, ctx?: HttpCtx, init: RequestInit = {}): Promise<T> {
  return withRetry(async () => {
    const res = await doFetch(url, ctx, {
      ...init,
      headers: mergedHeaders(ctx, { Accept: "application/json", ...(init.headers as Record<string, string>) }),
    });
    return (await res.json()) as T;
  });
}

export async function fetchText(url: string, ctx?: HttpCtx, init: RequestInit = {}): Promise<string> {
  return withRetry(async () => {
    const res = await doFetch(url, ctx, init);
    return await res.text();
  });
}

export async function fetchBytes(
  url: string,
  ctx?: HttpCtx,
  init: RequestInit = {},
): Promise<{ bytes: Uint8Array; contentType: string }> {
  return withRetry(async () => {
    const res = await doFetch(url, ctx, init);
    const buf = await res.arrayBuffer();
    return { bytes: new Uint8Array(buf), contentType: res.headers.get("content-type") ?? "" };
  });
}
