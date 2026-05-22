/**
 * Offline test of the plugin bridge: starts the WebSocket bridge, connects a
 * simulated plugin client, pairs, streams the fixture as a selection, then
 * calls plumb_selection over an in-memory MCP transport. No Figma needed.
 */
import { once } from "node:events";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { WebSocket } from "ws";
import { startBridge } from "../src/bridge/server";
import { bridge } from "../src/bridge/store";
import { createServer } from "../src/server";

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

// --- simulate the Figma plugin ------------------------------------------
const ws = new WebSocket(`ws://127.0.0.1:${bridge.port}`);
// Attach the listener before the socket opens — the server sends plumb-hello
// immediately on connect (the real plugin UI does the same).
let gotHello = false;
let gotPaired = false;
ws.on("message", (raw) => {
  const msg = JSON.parse(String(raw)) as { t?: string };
  if (msg.t === "plumb-hello") gotHello = true;
  if (msg.t === "paired") gotPaired = true;
});
await once(ws, "open");
await delay(120);
check("server sends plumb-hello on connect", gotHello);

// the user "clicks Pair with Plumb"
ws.send(JSON.stringify({ t: "pair", pluginVersion: "test" }));
await delay(120);
check("server confirms pairing", gotPaired && bridge.paired);

// the plugin streams the current selection
ws.send(
  JSON.stringify({
    t: "selection",
    doc: fixture,
    fileName: "Fixture file",
    pageName: "Page 1",
    nodeName: "Export employees · dialog",
  }),
);
await delay(120);
check("server stored the streamed selection", bridge.selection !== null);

// --- call the tools over MCP --------------------------------------------
const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
const server = createServer();
await server.connect(serverTransport);
const client = new Client({ name: "plumb-bridge-test", version: "0.0.0" });
await client.connect(clientTransport);

const status = parse(await client.callTool({ name: "plumb_status", arguments: {} }));
check("plumb_status reports the plugin connected", status.plugin?.connected === true);

const sel = parse(
  await client.callTool({ name: "plumb_selection", arguments: { depth: 3 } }),
);
check(
  "plumb_selection returns a PDS from the plugin path",
  sel.source === "plugin" && !sel.error && typeof sel.nodes === "object",
  `${sel.meta?.nodeCount} nodes, ~${sel.meta?.estTokens} tokens`,
);

ws.close();
await client.close();
await server.close();

console.log("─".repeat(58));
if (failed) {
  console.error(`✗ ${failed} check(s) failed.`);
  process.exit(1);
}
console.log("✓ PASS: the bridge pairs, streams, and serves plumb_selection (offline).");
process.exit(0);
