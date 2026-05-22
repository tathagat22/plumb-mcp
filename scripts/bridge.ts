/**
 * Offline test of the plugin bridge. Starts the WebSocket bridge, connects a
 * simulated plugin (pairs, streams an inventory, answers get-node / get-assets),
 * then exercises plumb_outline / plumb_node / plumb_assets over an in-memory
 * MCP transport. No Figma needed.
 */
import { once } from "node:events";
import { existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { WebSocket } from "ws";
import { startBridge } from "../src/bridge/server";
import { bridge } from "../src/bridge/store";
import { createServer } from "../src/server";

process.env.PLUMB_ASSETS_DIR = join(tmpdir(), `plumb-bridge-${Date.now()}`);

const here = dirname(fileURLToPath(import.meta.url));
const fixture = JSON.parse(
  readFileSync(join(here, "fixtures", "export-employees.json"), "utf8"),
) as unknown;

const delay = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

function parse(res: unknown): Record<string, any> {
  const content = (res as { content?: { text?: string }[] }).content ?? [];
  return JSON.parse(content[0]?.text ?? "{}") as Record<string, any>;
}

let failed = 0;
function check(label: string, ok: boolean, detail = ""): void {
  console.log(`${ok ? "✓" : "✗"} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failed += 1;
}

await startBridge();
check("bridge bound a localhost port", bridge.port !== null, `port ${bridge.port}`);

// --- simulated Figma plugin ---------------------------------------------
const fakeSvg = Buffer.from(
  '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>',
).toString("base64");

const ws = new WebSocket(`ws://127.0.0.1:${bridge.port}`);
let gotHello = false;
let gotPaired = false;
ws.on("message", (raw) => {
  const msg = JSON.parse(String(raw)) as { t?: string; reqId?: string };
  if (msg.t === "plumb-hello") gotHello = true;
  if (msg.t === "paired") gotPaired = true;
  if (msg.t === "get-node") {
    ws.send(
      JSON.stringify({
        t: "node",
        reqId: msg.reqId,
        doc: fixture,
        nodeName: "Export employees · dialog",
      }),
    );
  }
  if (msg.t === "get-assets") {
    ws.send(
      JSON.stringify({
        t: "assets",
        reqId: msg.reqId,
        error: null,
        assets: [{ id: "i1", name: "star icon", format: "SVG", dataBase64: fakeSvg }],
      }),
    );
  }
});
await once(ws, "open");

ws.send(JSON.stringify({ t: "pair", pluginVersion: "test" }));
await delay(120);
check("server confirms pairing", gotHello && gotPaired && bridge.paired);

ws.send(
  JSON.stringify({
    t: "inventory",
    fileName: "Test File",
    pages: [
      {
        id: "0:1",
        name: "Page 1",
        frames: [
          { id: "131:6950", name: "Export Dialog", w: 528, h: 578 },
          { id: "131:1", name: "Login", w: 1440, h: 1024 },
          { id: "131:2", name: "Login", w: 375, h: 812 },
        ],
      },
    ],
  }),
);
ws.send(
  JSON.stringify({
    t: "selection",
    doc: fixture,
    fileName: "Test File",
    pageName: "Page 1",
    nodeName: "Export employees · dialog",
  }),
);
await delay(120);
check("server stored the inventory", bridge.inventory !== null);

// --- MCP tools ----------------------------------------------------------
const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
const server = createServer();
await server.connect(serverTransport);
const client = new Client({ name: "plumb-bridge-test", version: "0.0.0" });
await client.connect(clientTransport);

const outline = parse(await client.callTool({ name: "plumb_outline", arguments: {} }));
check(
  "plumb_outline returns the plugin inventory",
  outline.source === "plugin" && outline.meta?.screenCount === 3,
  `${outline.meta?.screenCount} screens`,
);

const byName = parse(
  await client.callTool({ name: "plumb_node", arguments: { name: "Export" } }),
);
check(
  "plumb_node by unique name returns a PDS",
  byName.source === "plugin" && !byName.error && typeof byName.nodes === "object",
  `${byName.meta?.nodeCount} nodes`,
);

const dup = parse(
  await client.callTool({ name: "plumb_node", arguments: { name: "Login" } }),
);
check(
  "plumb_node on a duplicate name returns all matches",
  dup.ambiguous === true && Array.isArray(dup.matches) && dup.matches.length === 2,
  `${dup.matches ? dup.matches.length : 0} matches`,
);

const assets = parse(
  await client.callTool({ name: "plumb_assets", arguments: { id: "131:6950" } }),
);
check(
  "plumb_assets writes asset files and returns paths",
  assets.source === "plugin" &&
    assets.count === 1 &&
    typeof assets.assets?.[0]?.path === "string" &&
    existsSync(assets.assets[0].path),
  assets.assets?.[0]?.path ?? "(no path)",
);

const status = parse(await client.callTool({ name: "plumb_status", arguments: {} }));
check("plumb_status reports the screen count", status.plugin?.screens === 3);

ws.close();
await client.close();
await server.close();

console.log("─".repeat(60));
if (failed) {
  console.error(`✗ ${failed} check(s) failed.`);
  process.exit(1);
}
console.log("✓ PASS: bridge + inventory + by-name fetch + asset export all work (offline).");
process.exit(0);
