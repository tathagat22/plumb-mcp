import { createServer as createNetServer, type Server as HttpServer } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { bridge } from "./store";
import { requestAssets, startBridge, stopBridge } from "./server";
import { BRIDGE_PORTS } from "./protocol";

/**
 * Real-socket integration tests for the bridge — the message-handling switch
 * (Phase A2: a malformed message must be dropped, not crash the shared
 * process) and the port-pool fallback (multi-agent sessions) can't be
 * meaningfully verified any other way, since both are properties of the
 * live WebSocketServer, not of a pure function.
 */

function connectAndPair(port: number): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`);
    ws.once("error", reject);
    ws.once("open", () => {
      ws.once("message", (raw) => {
        // First frame is always `plumb-hello`; send `pair` and wait for `paired`.
        void raw;
        ws.once("message", (paired) => {
          const msg = JSON.parse(String(paired));
          if (msg.t === "paired") resolve(ws);
          else reject(new Error(`Expected "paired", got ${JSON.stringify(msg)}`));
        });
        ws.send(JSON.stringify({ t: "pair", pluginVersion: "test" }));
      });
    });
  });
}

function nextMessage(ws: WebSocket): Promise<any> {
  return new Promise((resolve) => {
    ws.once("message", (raw) => resolve(JSON.parse(String(raw))));
  });
}

describe("bridge port-pool fallback", () => {
  let occupied: HttpServer | undefined;

  afterAll(async () => {
    await stopBridge();
    if (occupied) await new Promise<void>((resolve) => occupied!.close(() => resolve()));
  });

  it("skips a port that's already taken", async () => {
    // Don't assume which port is free in this environment (a real `plumb-mcp`
    // may already be running, e.g. this very session) — discover what
    // startBridge picks naturally first, then force a collision on exactly
    // that port and confirm it falls through to a different one. This is
    // the same situation a second concurrent `plumb-mcp` session hits in
    // real multi-agent use.
    await startBridge();
    const firstPort = bridge.port;
    expect(firstPort).not.toBeNull();
    await stopBridge();

    occupied = createNetServer();
    await new Promise<void>((resolve, reject) => {
      occupied!.once("error", reject);
      occupied!.listen(firstPort!, "127.0.0.1", resolve);
    });

    await startBridge();
    expect(bridge.port).not.toBeNull();
    expect(bridge.port).not.toBe(firstPort);
    expect(BRIDGE_PORTS).toContain(bridge.port);
  });
});

describe("bridge message-handling robustness (Phase A2)", () => {
  let ws: WebSocket;

  beforeAll(async () => {
    await startBridge();
    if (!bridge.port) throw new Error("bridge failed to bind a port for the test");
    ws = await connectAndPair(bridge.port);
  });

  afterAll(async () => {
    ws.close();
    await stopBridge();
  });

  it("drops a malformed `inventory` message (missing `pages`) without crashing the connection", async () => {
    ws.send(JSON.stringify({ t: "inventory", fileName: "test.fig" })); // no `pages`
    // If the server crashed the process, this whole test file would die.
    // Prove the connection is still alive by completing an unrelated
    // round-trip afterward.
    const assetsPromise = requestAssets({ list: true });
    const getAssets = await nextMessage(ws);
    expect(getAssets.t).toBe("get-assets");
    ws.send(JSON.stringify({ t: "assets", reqId: getAssets.reqId, assets: [], error: null }));
    await expect(assetsPromise).resolves.toEqual({ assets: [], error: null });
  });

  it("degrades gracefully when `assets` arrives as a non-array instead of throwing", async () => {
    const assetsPromise = requestAssets({ list: true });
    const getAssets = await nextMessage(ws);
    expect(getAssets.t).toBe("get-assets");
    // A stale/future/misbehaving plugin build sends the wrong shape.
    ws.send(
      JSON.stringify({ t: "assets", reqId: getAssets.reqId, assets: "not-an-array", error: null }),
    );
    const result = await assetsPromise;
    expect(result.assets).toEqual([]);
  });

  it("still serves a normal request after two malformed messages", async () => {
    const assetsPromise = requestAssets({ list: true });
    const getAssets = await nextMessage(ws);
    ws.send(
      JSON.stringify({
        t: "assets",
        reqId: getAssets.reqId,
        assets: [{ id: "1:1", name: "icon", format: "SVG", path: null }],
        error: null,
      }),
    );
    const result = await assetsPromise;
    expect(result.assets).toHaveLength(1);
    expect(result.assets[0]?.id).toBe("1:1");
  });
});
