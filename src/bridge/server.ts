import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { createWriteStream } from "node:fs";
import { basename, join } from "node:path";
import { tmpdir } from "node:os";
import { WebSocketServer, type WebSocket } from "ws";
import { BRIDGE_PORTS } from "./protocol";
import { bridge } from "./store";
import { PlumbError } from "../errors";
import { SERVER_VERSION } from "../meta";
import { onStudio, recentStudio } from "../studio/events";
import { serveStudio, studioAvailable } from "../studio/serve";
import type { FigmaNode } from "../figma/types";
import type {
  ApplyProgressMessage,
  ComponentInfo,
  EmitPlan,
  EmitResult,
  FoundationsPlan,
  FoundationsResult,
  InstanceInfo,
  MotionPlan,
  MotionResult,
  PluginMessage,
  SearchMatch,
  ServerMessage,
  WireAsset,
} from "./protocol";

let pairedSocket: WebSocket | null = null;
let reqCounter = 0;

/** reqId → path the plugin's binary upload was written to. Drained when the
 *  matching `screenshot` WS reply arrives, so the resolved promise can carry
 *  the on-disk path instead of a base64 string. */
const uploadMap = new Map<string, { path: string }>();

interface Pending {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  /** Reassignable: an apply-progress heartbeat resets the watchdog in place. */
  timer: ReturnType<typeof setTimeout>;
  /** ms — the timeout to re-arm on each heartbeat (write ops only). */
  timeoutMs: number;
  label: string;
}
const pending = new Map<string, Pending>();

/** Non-terminal apply-progress listeners, keyed by reqId (write ops only). */
const progressListeners = new Map<string, (p: ApplyProgressMessage) => void>();

/** Staged inbound asset bytes the plugin pulls via GET /asset/:key.:ext.
 *  TTL 10 min, lazy-expired on read. */
const inbound = new Map<string, { bytes: Buffer; contentType: string; expires: number }>();
const INBOUND_TTL_MS = 10 * 60 * 1000;
let inboundCounter = 0;

const EXT_CONTENT_TYPE: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
  svg: "image/svg+xml",
};

function send(ws: WebSocket, msg: ServerMessage): void {
  try {
    ws.send(JSON.stringify(msg));
  } catch {
    // socket may have closed — ignore
  }
}

/** stdout is the MCP protocol channel; bridge logs go to stderr. */
function log(line: string): void {
  process.stderr.write(`plumb bridge: ${line}\n`);
}

function resolvePending(reqId: string, value: unknown): void {
  const p = pending.get(reqId);
  if (!p) {
    // Reply arrived after we already timed out — surface it so we can tell
    // a slow-but-eventual reply from a genuine hang during debugging.
    log(`late reply for ${reqId} (already timed out or unknown)`);
    return;
  }
  clearTimeout(p.timer);
  pending.delete(reqId);
  p.resolve(value);
}

function rejectAllPending(error: Error): void {
  for (const p of pending.values()) {
    clearTimeout(p.timer);
    p.reject(error);
  }
  pending.clear();
  progressListeners.clear();
}

/** Send a request to the paired plugin and await its matching reply. */
function request<T>(
  build: (reqId: string) => ServerMessage,
  timeoutMs: number,
  label: string,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    if (!pairedSocket) {
      reject(
        new PlumbError(
          "No Figma plugin is paired.",
          "Open your file in Figma, run the Plumb plugin, and click 'Pair with Plumb'.",
        ),
      );
      return;
    }
    const reqId = `r${++reqCounter}`;
    const timer = setTimeout(() => {
      pending.delete(reqId);
      progressListeners.delete(reqId);
      reject(
        new PlumbError(
          `The Plumb plugin did not answer the ${label} request in time.`,
          "Make sure the plugin is still running and paired in Figma, then retry.",
        ),
      );
    }, timeoutMs);
    pending.set(reqId, {
      resolve: resolve as (v: unknown) => void,
      reject,
      timer,
      timeoutMs,
      label,
    });
    send(pairedSocket, build(reqId));
  });
}

/**
 * Ask the plugin to serialize a node by id. `depth` (v0.10+) bounds the
 * subtree walk inside the plugin so dense screens don't pay full-tree
 * serialization cost on every call — pass `normalize-depth + 1` so the
 * normalizer can still emit accurate `more` counts at its boundary. Omit
 * to fall back to the v0.9 unbounded walk (used by selection / verify).
 *
 * Responses are cached on the server keyed on `(nodeId, depth)` and
 * invalidated whenever the plugin pushes a new inventory (which it does
 * on every `documentchange`). That makes the drill-into-then-back-out
 * workflow effectively free after the first call, and the verify loop
 * stops re-fetching every parent for each delta check.
 */
export async function requestNode(
  nodeId: string,
  depth?: number,
): Promise<{ doc: FigmaNode | null; nodeName: string | null }> {
  const key = `${nodeId}:${depth ?? "all"}`;
  const cached = bridge.nodeCache.get(key);
  if (cached && cached.fileVersion === bridge.fileVersion) {
    return { doc: cached.doc, nodeName: cached.nodeName };
  }
  const result = await request<{ doc: FigmaNode | null; nodeName: string | null }>(
    (reqId) => ({ t: "get-node", reqId, nodeId, depth }),
    60_000,
    "node",
  );
  bridge.nodeCache.set(key, { ...result, fileVersion: bridge.fileVersion });
  return result;
}

export interface RequestAssetsOptions {
  /** Screen/node to scope the recursive export to. */
  nodeId?: string;
  /** Surgical mode — export exactly these ids (no recursion). */
  ids?: string[];
  /** Manifest only — no file bytes over the wire. */
  list?: boolean;
  /** When true, image-fill nodes ship their original uploaded bytes
   *  (via getImageByHash) instead of a rasterised PNG render. */
  raw?: boolean;
}

/** reqId → timestamp of the get-assets request, used to time-stamp uploads. */
const assetRequestStart = new Map<string, number>();

/** Ask the plugin to export assets (default: every asset in `nodeId`). */
export function requestAssets(
  opts: RequestAssetsOptions,
): Promise<{ assets: WireAsset[]; error: string | null }> {
  return request(
    (reqId) => {
      assetRequestStart.set(reqId, Date.now());
      return {
        t: "get-assets",
        reqId,
        nodeId: opts.nodeId ?? "",
        ids: opts.ids,
        list: opts.list,
        raw: opts.raw,
      };
    },
    180_000,
    "assets",
  );
}

/** Ask the plugin to render a node as PNG/JPG. The image bytes arrive over a
 *  side-channel HTTP POST from the plugin UI — the WS reply is just metadata.
 *  Resolved `path` is a temp file the caller should rename/move. */
export function requestScreenshot(
  nodeId: string,
  scale?: number,
  format?: "PNG" | "JPG",
): Promise<{
  path: string | null;
  format: string;
  nodeName: string | null;
  error: string | null;
}> {
  return request(
    (reqId) => ({ t: "get-screenshot", reqId, nodeId, scale, format }),
    240_000,
    "screenshot",
  );
}

/** Ask the plugin to find nodes by name and/or type. */
export function requestSearch(
  query?: string,
  type?: string,
): Promise<{ matches: SearchMatch[]; error: string | null }> {
  return request(
    (reqId) => ({ t: "get-search", reqId, query, type }),
    30_000,
    "search",
  );
}

/** Ask the plugin to gather every component definition + instance usage. */
export function requestComponents(): Promise<{
  components: ComponentInfo[];
  instances: InstanceInfo[];
  error: string | null;
}> {
  return request(
    (reqId) => ({ t: "get-components", reqId }),
    60_000,
    "components",
  );
}

/* ------------------------------------------------------------------ */
/* Write direction — apply wrappers + inbound asset staging            */
/* ------------------------------------------------------------------ */

/**
 * Build + apply a full design (blueprint §3). Uses a 600s watchdog that each
 * non-terminal `apply-progress` heartbeat RESETS in place — a big page that
 * keeps making progress never times out, but a genuinely hung apply still does.
 */
export function requestApplyDesign(
  plan: EmitPlan,
  onProgress?: (p: ApplyProgressMessage) => void,
): Promise<{ result: EmitResult | null; error: string | null }> {
  return new Promise((resolve, reject) => {
    request<{ result: EmitResult | null; error: string | null }>(
      (reqId) => {
        if (onProgress) progressListeners.set(reqId, onProgress);
        return { t: "apply-design", reqId, plan };
      },
      600_000,
      "apply-design",
    ).then(resolve, reject);
  });
}

/** Alias — the blueprint refers to this wrapper as `requestApply`. */
export const requestApply = requestApplyDesign;

/** Apply Variables / text / effect / grid styles (blueprint §3). */
export async function requestApplyFoundations(
  plan: FoundationsPlan,
  dryRun?: boolean,
): Promise<FoundationsResult> {
  return request<FoundationsResult>(
    (reqId) => ({ t: "apply-foundations", reqId, plan, dryRun }),
    120_000,
    "foundations",
  );
}

/** Wire prototype reactions / flows / device onto the built nodes (blueprint §3). */
export async function requestApplyMotion(
  plan: MotionPlan,
  idMap?: Record<string, string>,
): Promise<MotionResult> {
  return request<MotionResult>(
    (reqId) => ({ t: "apply-motion", reqId, plan, idMap }),
    120_000,
    "motion",
  );
}

/**
 * Stage bytes for the plugin to pull via GET /asset/:key.:ext. Returns the
 * key. TTL 10 min, lazy-expired on read. The asset engine's inbound.registerAsset
 * delegates here — server.ts is the single home for the HTTP route + the map.
 */
export function stageInboundAsset(bytes: Buffer | Uint8Array, ext: string): string {
  const key = `a${++inboundCounter}${Date.now().toString(36)}`;
  const buf = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  const e = ext.toLowerCase().replace(/^\./, "");
  inbound.set(key, {
    bytes: buf,
    contentType: EXT_CONTENT_TYPE[e] ?? "application/octet-stream",
    expires: Date.now() + INBOUND_TTL_MS,
  });
  return key;
}

/** HTTP request handler for the bridge's loopback server. Serves CORS preflight,
 *  the `/upload/:reqId.:ext` POST that the plugin UI uses to ship raw screenshot
 *  bytes, and the `/asset/:key.:ext` GET the plugin pulls inbound bytes from —
 *  no base64 anywhere in the hot path. */
function handleHttp(req: IncomingMessage, res: ServerResponse): void {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }
  if (req.method === "GET") {
    // Inbound asset pull: the plugin UI eager-hydrates plan.assets from here.
    const am = req.url && /^\/asset\/([A-Za-z0-9_-]+)\.([a-z0-9]+)$/.exec(req.url);
    if (am) {
      const key = am[1]!;
      const staged = inbound.get(key);
      if (!staged || staged.expires < Date.now()) {
        if (staged) inbound.delete(key); // lazy-expire on read
        res.writeHead(404);
        res.end();
        return;
      }
      res.writeHead(200, {
        "Content-Type": staged.contentType,
        "Content-Length": staged.bytes.length,
      });
      res.end(staged.bytes);
      return;
    }
    // Anything else → the Plumb Studio SPA.
    serveStudio(req, res);
    return;
  }
  const m = req.url && /^\/upload\/([A-Za-z0-9_-]+)\.([a-z0-9]+)$/.exec(req.url);
  if (!m || req.method !== "POST") {
    res.writeHead(404);
    res.end();
    return;
  }
  const reqId = m[1]!;
  const ext = m[2]!;
  const path = join(tmpdir(), `plumb-${reqId}.${ext}`);
  const out = createWriteStream(path);
  req.pipe(out);
  out.on("finish", () => {
    uploadMap.set(reqId, { path });
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true }));
  });
  out.on("error", (err) => {
    log(`upload write failed: ${err.message}`);
    res.writeHead(500);
    res.end();
  });
}

/**
 * A connected Plumb Studio UI. Replays the recent event backlog, then streams
 * live events from the bus until the socket closes. Read-only — Studio clients
 * never send into the bridge's plugin protocol.
 */
function handleStudioClient(ws: WebSocket): void {
  const sendEvent = (payload: unknown): void => {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(payload));
  };
  sendEvent({ t: "studio-hello", serverVersion: SERVER_VERSION, backlog: recentStudio() });
  const unsubscribe = onStudio((e) => sendEvent({ t: "studio-event", event: e }));
  ws.on("close", unsubscribe);
  ws.on("error", unsubscribe);
}

function bindPort(port: number): Promise<{ wss: WebSocketServer; http: Server } | null> {
  return new Promise((resolve) => {
    const http = createServer(handleHttp);
    const wss = new WebSocketServer({ server: http });
    // Multi-agent connect: when a second `plumb-mcp` boots and 31337 is taken,
    // http emits 'error' AND wss emits 'error' (it's attached to the same
    // server). Without this swallow the wss error propagates as uncaught and
    // crashes the new server before it can fall through to the next port.
    wss.on("error", () => undefined);
    http.once("listening", () => resolve({ wss, http }));
    http.once("error", () => resolve(null));
    http.listen(port, "127.0.0.1");
  });
}

/**
 * Start the localhost WebSocket bridge the Plumb plugin connects to (plan §4).
 * Best-effort: if no port is free, the MCP server still runs on the REST path.
 *
 * Security (plan §14): loopback-only bind; pairing is a deliberate "Pair with
 * Plumb" click in the plugin panel; only one plugin may be paired at a time;
 * data and replies from unpaired connections are ignored.
 */
export async function startBridge(): Promise<void> {
  let wss: WebSocketServer | null = null;
  let chosen = 0;
  for (const port of BRIDGE_PORTS) {
    const bound = await bindPort(port);
    if (bound) {
      wss = bound.wss;
      chosen = port;
      break;
    }
  }
  if (!wss) {
    log("no free port in range — plugin path disabled, REST path still works");
    return;
  }
  bridge.port = chosen;
  const sessionLabel = process.env.PLUMB_SESSION_NAME?.trim() || basename(process.cwd());
  log(`listening on 127.0.0.1:${chosen} as "${sessionLabel}"`);
  if (studioAvailable()) {
    log(`Plumb Studio (live cockpit): http://127.0.0.1:${chosen}/  ·  run \`plumb-mcp studio\` to open it`);
  }

  wss.on("connection", (ws, req) => {
    // Studio UIs connect to /studio — they only listen to the event bus, never
    // take part in the plugin pairing handshake.
    if (req.url && req.url.startsWith("/studio")) {
      handleStudioClient(ws);
      return;
    }
    log(`connection from origin ${req.headers.origin ?? "(none)"}`);
    send(ws, { t: "plumb-hello", serverVersion: SERVER_VERSION, sessionLabel });

    let thisPaired = false;

    ws.on("message", (raw) => {
      let msg: PluginMessage;
      try {
        msg = JSON.parse(String(raw)) as PluginMessage;
      } catch {
        return;
      }

      // Everything below assumes `msg` actually matches the `PluginMessage`
      // shape the `t` cast promises — true for a well-behaved plugin build,
      // not guaranteed for a stale/future/misbehaving one. A shape mismatch
      // (e.g. an `inventory` message missing `pages`) must degrade to a
      // dropped message, not a process-crashing throw inside a WS handler
      // that nothing upstream catches.
      try {
        handlePluginMessage(msg);
      } catch (e) {
        log(
          `dropped malformed message (t=${(msg as { t?: string })?.t ?? "?"}): ${
            e instanceof Error ? e.message : String(e)
          }`,
        );
      }
    });

    function handlePluginMessage(msg: PluginMessage): void {
      if (msg.t === "pair") {
        if (bridge.paired && !thisPaired) {
          send(ws, { t: "pair-rejected", reason: "Another Plumb plugin is already paired." });
          return;
        }
        bridge.paired = true;
        bridge.pluginVersion = msg.pluginVersion;
        bridge.lastSeen = Date.now();
        thisPaired = true;
        pairedSocket = ws;
        send(ws, { t: "paired" });
        log("plugin paired");
        return;
      }

      if (!thisPaired) return; // ignore everything else from unpaired connections
      bridge.lastSeen = Date.now();

      switch (msg.t) {
        case "selection":
          bridge.selection = msg.doc
            ? {
                doc: msg.doc as FigmaNode,
                fileName: msg.fileName,
                pageName: msg.pageName,
                nodeName: msg.nodeName ?? "",
                receivedAt: Date.now(),
              }
            : null;
          break;
        case "inventory": {
          if (!Array.isArray(msg.pages)) {
            log("dropped inventory message: `pages` is not an array");
            break;
          }
          bridge.inventory = { fileName: msg.fileName, pages: msg.pages };
          // Plugin debounce-pushes inventory on every `documentchange`,
          // so this is our cheapest signal that something in the file may
          // have changed. Bump the version and nuke the node cache so the
          // next request actually re-fetches.
          bridge.fileVersion += 1;
          if (bridge.nodeCache.size > 0) bridge.nodeCache.clear();
          log(`inventory: ${msg.pages.reduce((n, p) => n + (p.frames?.length ?? 0), 0)} screen(s)`);
          break;
        }
        case "node":
          resolvePending(msg.reqId, { doc: msg.doc, nodeName: msg.nodeName });
          break;
        case "assets": {
          if (!Array.isArray(msg.assets)) {
            log("dropped assets message: `assets` is not an array");
            resolvePending(msg.reqId, { assets: [], error: msg.error ?? "malformed assets reply" });
            break;
          }
          // Plugin streams bytes via HTTP /upload/${reqId}-${i}.${ext}, then
          // sends this manifest over WS with `path: null`. Pull the bridge's
          // on-disk temp path for each asset by index. `list: true` mode skips
          // uploads — those entries keep path = null.
          const filled = msg.assets.map((a, i) => {
            if (a.path !== null) return a;
            const key = `${msg.reqId}-${i}`;
            const upload = uploadMap.get(key);
            uploadMap.delete(key);
            return { ...a, path: upload?.path ?? null };
          });
          const startedAt = assetRequestStart.get(msg.reqId);
          assetRequestStart.delete(msg.reqId);
          if (startedAt !== undefined) {
            log(`assets reply: ${filled.length} asset(s) in ${Date.now() - startedAt}ms`);
          }
          resolvePending(msg.reqId, { assets: filled, error: msg.error });
          break;
        }
        case "screenshot": {
          const upload = uploadMap.get(msg.reqId);
          uploadMap.delete(msg.reqId);
          resolvePending(msg.reqId, {
            path: upload?.path ?? null,
            format: msg.format,
            nodeName: msg.nodeName,
            error: msg.error,
          });
          break;
        }
        case "search":
          resolvePending(msg.reqId, { matches: msg.matches, error: msg.error });
          break;
        case "components":
          resolvePending(msg.reqId, {
            components: msg.components,
            instances: msg.instances,
            error: msg.error,
          });
          break;
        case "apply-progress": {
          // NON-TERMINAL heartbeat: reset the 600s watchdog in place, notify the
          // listener (drives Studio), and DO NOT resolve the pending request.
          const p = pending.get(msg.reqId);
          if (p) {
            clearTimeout(p.timer);
            p.timer = setTimeout(() => {
              pending.delete(msg.reqId);
              progressListeners.delete(msg.reqId);
              p.reject(
                new PlumbError(
                  `The Plumb plugin did not answer the ${p.label} request in time.`,
                  "Make sure the plugin is still running and paired in Figma, then retry.",
                ),
              );
            }, p.timeoutMs);
          }
          progressListeners.get(msg.reqId)?.(msg);
          break;
        }
        case "applied":
          // A write just changed the document — invalidate the read cache NOW so
          // a follow-up plumb_review / plumb_node re-serializes the fresh nodes,
          // instead of waiting for the plugin's debounced `inventory` push (which
          // otherwise lets review read stale geometry/colours right after a build).
          bridge.fileVersion += 1;
          if (bridge.nodeCache.size > 0) bridge.nodeCache.clear();
          progressListeners.delete(msg.reqId);
          resolvePending(msg.reqId, { result: msg.result, error: msg.error });
          break;
        case "foundations":
          resolvePending(
            msg.reqId,
            msg.result ?? {
              collections: [],
              textStyleIds: {},
              effectStyleIds: {},
              gridStyleIds: {},
              warnings: [msg.error ?? "foundations failed"],
            },
          );
          break;
        case "motion":
          resolvePending(
            msg.reqId,
            msg.result ?? { wired: 0, misses: [], error: msg.error },
          );
          break;
        case "pong":
          break;
      }
    }

    ws.on("close", () => {
      if (thisPaired) {
        pairedSocket = null;
        bridge.reset();
        rejectAllPending(
          new PlumbError(
            "The Plumb plugin disconnected mid-request.",
            "Re-run the Plumb plugin in Figma and pair again, then retry.",
          ),
        );
        log("plugin disconnected");
      }
    });

    ws.on("error", () => {
      /* errors surface as a subsequent close */
    });
  });
}
