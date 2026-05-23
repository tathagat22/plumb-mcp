import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { createWriteStream } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { WebSocketServer, type WebSocket } from "ws";
import { BRIDGE_PORTS } from "./protocol";
import { bridge } from "./store";
import { PlumbError } from "../errors";
import { SERVER_VERSION } from "../meta";
import type { FigmaNode } from "../figma/types";
import type {
  ComponentInfo,
  InstanceInfo,
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
  timer: ReturnType<typeof setTimeout>;
}
const pending = new Map<string, Pending>();

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
      reject(
        new PlumbError(
          `The Plumb plugin did not answer the ${label} request in time.`,
          "Make sure the plugin is still running and paired in Figma, then retry.",
        ),
      );
    }, timeoutMs);
    pending.set(reqId, { resolve: resolve as (v: unknown) => void, reject, timer });
    send(pairedSocket, build(reqId));
  });
}

/** Ask the plugin to serialize a node by id. */
export function requestNode(
  nodeId: string,
): Promise<{ doc: FigmaNode | null; nodeName: string | null }> {
  return request((reqId) => ({ t: "get-node", reqId, nodeId }), 60_000, "node");
}

export interface RequestAssetsOptions {
  /** Screen/node to scope the recursive export to. */
  nodeId?: string;
  /** Surgical mode — export exactly these ids (no recursion). */
  ids?: string[];
  /** Manifest only — no file bytes over the wire. */
  list?: boolean;
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

/** HTTP request handler for the bridge's loopback server. Serves CORS preflight
 *  and the `/upload/:reqId.:ext` POST that the plugin UI uses to ship raw
 *  screenshot bytes — no base64 anywhere in the hot path. */
function handleHttp(req: IncomingMessage, res: ServerResponse): void {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
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

function bindPort(port: number): Promise<{ wss: WebSocketServer; http: Server } | null> {
  return new Promise((resolve) => {
    const http = createServer(handleHttp);
    const wss = new WebSocketServer({ server: http });
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
  log(`listening on 127.0.0.1:${chosen}`);

  wss.on("connection", (ws, req) => {
    log(`connection from origin ${req.headers.origin ?? "(none)"}`);
    send(ws, { t: "plumb-hello", serverVersion: SERVER_VERSION });

    let thisPaired = false;

    ws.on("message", (raw) => {
      let msg: PluginMessage;
      try {
        msg = JSON.parse(String(raw)) as PluginMessage;
      } catch {
        return;
      }

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
        case "inventory":
          bridge.inventory = { fileName: msg.fileName, pages: msg.pages };
          log(`inventory: ${msg.pages.reduce((n, p) => n + p.frames.length, 0)} screen(s)`);
          break;
        case "node":
          resolvePending(msg.reqId, { doc: msg.doc, nodeName: msg.nodeName });
          break;
        case "assets": {
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
        case "pong":
          break;
      }
    });

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
