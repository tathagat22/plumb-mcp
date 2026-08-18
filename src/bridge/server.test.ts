import { createServer as createNetServer, type Server as HttpServer } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { bridge } from "./store";
import { requestAssets, startBridge, stopBridge } from "./server";

/**
 * Reserve two ports the OS confirms are free right now and pin the bridge to
 * them for the duration of a test.
 *
 * The default pool (31337–31346) is what real `plumb-mcp` sessions bind, so a
 * developer with a live editor session — or a CI runner with a leftover
 * process — has no free port in it, and these tests used to fail for reasons
 * that have nothing to do with the code under test. `PLUMB_BRIDGE_PORTS` makes
 * the pool an input instead of an ambient assumption.
 */
async function reserveFreePorts(count: number): Promise<number[]> {
  const servers = await Promise.all(
    Array.from({ length: count }, () =>
      new Promise<HttpServer>((resolve) => {
        const s = createNetServer();
        s.listen(0, "127.0.0.1", () => resolve(s));
      }),
    ),
  );
  const ports = servers.map((s) => {
    const addr = s.address();
    if (typeof addr !== "object" || !addr) throw new Error("no address for reserved port");
    return addr.port;
  });
  // Release them immediately — we only needed the OS to name ports nothing
  // else on this machine is using.
  await Promise.all(servers.map((s) => new Promise<void>((r) => s.close(() => r()))));
  return ports;
}

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
  const previousPool = process.env.PLUMB_BRIDGE_PORTS;

  afterAll(async () => {
    await stopBridge();
    if (occupied) await new Promise<void>((resolve) => occupied!.close(() => resolve()));
    if (previousPool === undefined) delete process.env.PLUMB_BRIDGE_PORTS;
    else process.env.PLUMB_BRIDGE_PORTS = previousPool;
  });

  it("skips a port that's already taken and binds the next one in the pool", async () => {
    const [first, second] = await reserveFreePorts(2);
    process.env.PLUMB_BRIDGE_PORTS = `${first},${second}`;

    // Hold the first port so the bridge has to fall through — this is exactly
    // what a second concurrent `plumb-mcp` session hits in multi-agent use.
    occupied = createNetServer();
    await new Promise<void>((resolve, reject) => {
      occupied!.once("error", reject);
      occupied!.listen(first!, "127.0.0.1", resolve);
    });

    await startBridge();
    expect(bridge.port).toBe(second);
  });

  it("reports no port when every port in the pool is taken", async () => {
    await stopBridge();
    const [only] = await reserveFreePorts(1);
    process.env.PLUMB_BRIDGE_PORTS = String(only);

    const blocker = createNetServer();
    await new Promise<void>((resolve, reject) => {
      blocker.once("error", reject);
      blocker.listen(only!, "127.0.0.1", resolve);
    });

    // The REST path still works with no bridge, so this must degrade to
    // `port === null`, never throw.
    await expect(startBridge()).resolves.toBeUndefined();
    expect(bridge.port).toBeNull();

    await new Promise<void>((resolve) => blocker.close(() => resolve()));
  });

  it("binds an OS-assigned port when the pool is set to 0", async () => {
    await stopBridge();
    process.env.PLUMB_BRIDGE_PORTS = "0";
    await startBridge();
    // Port 0 means "any free port" — `bridge.port` must report the port that
    // was actually bound, not the literal 0 that was requested.
    expect(bridge.port).toBeGreaterThan(0);
    await stopBridge();
  });
});

describe("bridge message-handling robustness (Phase A2)", () => {
  let ws: WebSocket;
  const previousPool = process.env.PLUMB_BRIDGE_PORTS;

  beforeAll(async () => {
    process.env.PLUMB_BRIDGE_PORTS = "0"; // any free port — never collide with a real session
    await startBridge();
    if (!bridge.port) throw new Error("bridge failed to bind a port for the test");
    ws = await connectAndPair(bridge.port);
  });

  afterAll(async () => {
    ws.close();
    await stopBridge();
    if (previousPool === undefined) delete process.env.PLUMB_BRIDGE_PORTS;
    else process.env.PLUMB_BRIDGE_PORTS = previousPool;
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
