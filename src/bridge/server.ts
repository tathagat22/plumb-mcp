import { WebSocketServer, type WebSocket } from "ws";
import { BRIDGE_PORTS } from "./protocol";
import { bridge } from "./store";
import { SERVER_VERSION } from "../meta";
import type { PluginMessage, ServerMessage } from "./protocol";
import type { FigmaNode } from "../figma/types";

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
 * data messages from unpaired connections are ignored.
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
          send(ws, {
            t: "pair-rejected",
            reason: "Another Plumb plugin is already paired.",
          });
          return;
        }
        bridge.paired = true;
        bridge.pluginVersion = msg.pluginVersion;
        bridge.lastSeen = Date.now();
        thisPaired = true;
        send(ws, { t: "paired" });
        log("plugin paired");
      } else if (msg.t === "selection") {
        if (!thisPaired) return; // ignore data from unpaired connections
        bridge.lastSeen = Date.now();
        if (msg.doc) {
          bridge.selection = {
            doc: msg.doc as FigmaNode,
            fileName: msg.fileName,
            pageName: msg.pageName,
            nodeName: msg.nodeName ?? "",
            receivedAt: Date.now(),
          };
          log(`selection: ${msg.nodeName ?? "(unnamed)"}`);
        } else {
          bridge.selection = null;
        }
      } else if (msg.t === "pong") {
        bridge.lastSeen = Date.now();
      }
    });

    ws.on("close", () => {
      if (thisPaired) {
        bridge.reset();
        log("plugin disconnected");
      }
    });

    ws.on("error", () => {
      /* errors surface as a subsequent close */
    });
  });
}
