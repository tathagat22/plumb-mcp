/**
 * Minimal Chrome DevTools Protocol client over WebSocket. Speaks the subset
 * of CDP we need to drive a headless browser end-to-end: navigate, wait for
 * load, inject JS, read the result. No Puppeteer.
 *
 * Why hand-rolled? Puppeteer pulls a managed Chrome binary (~150 MB) and a
 * fat API surface. We already ship `ws` for the plugin bridge, and CDP is a
 * simple JSON-RPC over WebSocket — under 200 lines does the job.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import WebSocket from "ws";

export interface BrowserOpts {
  chromePath: string;
  /** Extra Chrome flags; defaults cover headless + sandbox-friendly defaults. */
  extraFlags?: string[];
  /** Suppress Chrome's own stderr noise unless DEBUG is set. */
  verbose?: boolean;
}

export interface Browser {
  /** Send a CDP command to the page target, await the response. */
  send<T = unknown>(method: string, params?: Record<string, unknown>): Promise<T>;
  /** Subscribe to a CDP event; returns an unsubscribe function. */
  on(event: string, handler: (params: Record<string, unknown>) => void): () => void;
  /** Wait for an event to fire, optionally matching a predicate. */
  waitFor(
    event: string,
    predicate?: (params: Record<string, unknown>) => boolean,
    timeoutMs?: number,
  ): Promise<Record<string, unknown>>;
  /** Close the WebSocket and kill Chrome. */
  close(): Promise<void>;
}

/**
 * Launch Chrome headless, attach to the first page target, return a thin RPC
 * facade. Caller is responsible for closing it.
 */
export async function launchBrowser(opts: BrowserOpts): Promise<Browser> {
  const userDataDir = mkdtempSync(join(tmpdir(), "plumb-chrome-"));
  const flags = [
    "--headless=new",
    "--disable-gpu",
    "--no-first-run",
    "--no-default-browser-check",
    "--remote-debugging-port=0",
    `--user-data-dir=${userDataDir}`,
    // Locked-down sandboxes (CI, Docker) reject --enable-features without
    // --no-sandbox; users on a desktop don't need this but it's harmless.
    "--no-sandbox",
    ...(opts.extraFlags ?? []),
    "about:blank",
  ];

  const child = spawn(opts.chromePath, flags, { stdio: ["ignore", "pipe", "pipe"] });

  let wsUrl: string | undefined;
  const stderrBuf: string[] = [];
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Chrome failed to print a DevTools URL within 15s. stderr:\n${stderrBuf.join("")}`));
    }, 15_000);
    if (!child.stderr) {
      clearTimeout(timer);
      reject(new Error("Chrome stderr stream missing"));
      return;
    }
    child.stderr.on("data", (chunk: Buffer) => {
      const s = chunk.toString("utf8");
      stderrBuf.push(s);
      if (opts.verbose) process.stderr.write(`[chrome] ${s}`);
      const m = /DevTools listening on (ws:\/\/\S+)/.exec(s);
      if (m && m[1]) {
        wsUrl = m[1];
        clearTimeout(timer);
        resolve();
      }
    });
    child.on("exit", (code) => {
      clearTimeout(timer);
      reject(new Error(`Chrome exited (code ${code}). stderr:\n${stderrBuf.join("")}`));
    });
  });

  if (!wsUrl) throw new Error("Chrome printed no DevTools URL");

  // The first WS endpoint is the browser-level target; we need a page target
  // so DOM / Runtime / Page calls work. Hop via the discovery endpoint.
  const httpJson = wsUrl
    .replace(/^ws:\/\//, "http://")
    .replace(/\/devtools\/.*$/, "/json/list");
  const pageWs = await findPageTarget(httpJson);

  const ws = await connect(pageWs);

  let nextId = 1;
  type Pending = { resolve: (v: unknown) => void; reject: (e: Error) => void };
  const pending = new Map<number, Pending>();
  const handlers = new Map<string, Set<(p: Record<string, unknown>) => void>>();

  ws.on("message", (raw) => {
    let msg: { id?: number; result?: unknown; error?: { message: string }; method?: string; params?: Record<string, unknown> };
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }
    if (typeof msg.id === "number") {
      const p = pending.get(msg.id);
      if (!p) return;
      pending.delete(msg.id);
      if (msg.error) p.reject(new Error(`CDP ${msg.id}: ${msg.error.message}`));
      else p.resolve(msg.result);
      return;
    }
    if (msg.method) {
      const set = handlers.get(msg.method);
      if (!set) return;
      for (const h of set) {
        try { h(msg.params ?? {}); } catch { /* swallow handler errors */ }
      }
    }
  });

  function send<T>(method: string, params?: Record<string, unknown>): Promise<T> {
    const id = nextId++;
    return new Promise<T>((resolve, reject) => {
      pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
      ws.send(JSON.stringify({ id, method, params: params ?? {} }));
    });
  }

  function on(event: string, handler: (p: Record<string, unknown>) => void): () => void {
    let set = handlers.get(event);
    if (!set) {
      set = new Set();
      handlers.set(event, set);
    }
    set.add(handler);
    return () => set?.delete(handler);
  }

  function waitFor(
    event: string,
    predicate?: (params: Record<string, unknown>) => boolean,
    timeoutMs = 30_000,
  ): Promise<Record<string, unknown>> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        off();
        reject(new Error(`Timed out waiting for ${event}`));
      }, timeoutMs);
      const off = on(event, (p) => {
        if (predicate && !predicate(p)) return;
        clearTimeout(timer);
        off();
        resolve(p);
      });
    });
  }

  async function close(): Promise<void> {
    try { ws.close(); } catch { /* ignored */ }
    try { child.kill("SIGTERM"); } catch { /* ignored */ }
    try { rmSync(userDataDir, { recursive: true, force: true }); } catch { /* ignored */ }
  }

  return { send, on, waitFor, close };
}

async function findPageTarget(httpJsonUrl: string): Promise<string> {
  // Poll up to ~3s — Chrome briefly has zero pages right after startup.
  for (let i = 0; i < 30; i++) {
    try {
      const res = await fetch(httpJsonUrl);
      if (res.ok) {
        const list = (await res.json()) as Array<{ type: string; webSocketDebuggerUrl?: string }>;
        const page = list.find((t) => t.type === "page" && !!t.webSocketDebuggerUrl);
        if (page?.webSocketDebuggerUrl) return page.webSocketDebuggerUrl;
      }
    } catch {
      // try again
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`No Chrome page target available at ${httpJsonUrl}`);
}

function connect(wsUrl: string): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl, { perMessageDeflate: false });
    ws.once("open", () => resolve(ws));
    ws.once("error", reject);
  });
}

/** Convenience wrapper around Page.navigate + Page.loadEventFired. */
export async function navigate(b: Browser, url: string, waitMs = 0): Promise<void> {
  await b.send("Page.enable");
  await b.send("Runtime.enable");
  const loaded = b.waitFor("Page.loadEventFired", undefined, 30_000);
  await b.send("Page.navigate", { url });
  await loaded;
  if (waitMs > 0) await new Promise((r) => setTimeout(r, waitMs));
}

/**
 * Run a JS expression in the page and return the JSON-serialised result.
 * The function must return a JSON-able value (we use Runtime.evaluate with
 * returnByValue:true so functions / DOM nodes aren't supported, which is
 * fine for our capture script).
 */
export async function evaluate<T>(b: Browser, expression: string): Promise<T> {
  const res = (await b.send<{
    result?: { value?: T; type?: string };
    exceptionDetails?: { exception?: { description?: string } };
  }>("Runtime.evaluate", {
    expression,
    returnByValue: true,
    awaitPromise: true,
  }));
  if (res.exceptionDetails) {
    throw new Error(
      `Page-side error: ${res.exceptionDetails.exception?.description ?? "unknown"}`,
    );
  }
  return res.result?.value as T;
}
