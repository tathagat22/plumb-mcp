import { WebSocketServer, type WebSocket } from "ws";
import { BRIDGE_PORTS } from "./protocol";
import { bridge } from "./store";
import { PlumbError } from "../errors";
import { SERVER_VERSION } from "../meta";
import type { FigmaNode } from "../figma/types";
import type { PluginMessage, ServerMessage, WireAsset } from "./protocol";

let pairedSocket: WebSocket | null = null;
let reqCounter = 0;

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
  if (!p) return;
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
  return request((reqId) => ({ t: "get-node", reqId, nodeId }), 15_000, "node");
}

export interface RequestAssetsOptions {
  /** Screen/node to scope the recursive export to. */
  nodeId?: string;
  /** Surgical mode — export exactly these ids (no recursion). */
  ids?: string[];
  /** Manifest only — no file bytes over the wire. */
  list?: boolean;
}

/** Ask the plugin to export assets (default: every asset in `nodeId`). */
export function requestAssets(
  opts: RequestAssetsOptions,
): Promise<{ assets: WireAsset[]; error: string | null }> {
  return request(
    (reqId) => ({
      t: "get-assets",
      reqId,
      nodeId: opts.nodeId ?? "",
      ids: opts.ids,
      list: opts.list,
    }),
    90_000,
    "assets",
  );
}

function bindPort(port: number): Promise<WebSocketServer | null> {
  return new Promise((resolve) => {
    const wss = new WebSocketServer({ host: "127.0.0.1", port });
    wss.once("listening", () => resolve(wss));
    wss.once("error", () => resolve(null));
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
    wss = await bindPort(port);
    if (wss) {
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
        case "assets":
          resolvePending(msg.reqId, { assets: msg.assets, error: msg.error });
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
