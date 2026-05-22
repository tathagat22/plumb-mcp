/**
 * Live plugin test: start the bridge, wait for the real Figma plugin to pair
 * and stream a selection, then call plumb_selection over MCP and print it.
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { startBridge } from "../src/bridge/server";
import { bridge } from "../src/bridge/store";
import { createServer } from "../src/server";

const delay = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

function parse(res: unknown): Record<string, any> {
  const content = (res as { content?: { text?: string }[] }).content ?? [];
  return JSON.parse(content[0]?.text ?? "{}") as Record<string, any>;
}

await startBridge();
if (bridge.port === null) {
  console.error("✗ Bridge could not bind a port.");
  process.exit(1);
}
console.log(`Bridge listening on 127.0.0.1:${bridge.port}.`);
console.log("→ In Figma: run the Plumb plugin → click 'Pair with Plumb' → select a frame.");
console.log("Waiting up to 5 minutes …\n");

const deadline = Date.now() + 300_000;
let announcedPair = false;
while (Date.now() < deadline) {
  if (bridge.paired && !announcedPair) {
    const v = bridge.pluginVersion ? ` (v${bridge.pluginVersion})` : "";
    console.log(`✓ Plugin paired${v}.`);
    announcedPair = true;
  }
  if (bridge.paired && bridge.selection) break;
  await delay(500);
}

if (!bridge.paired) {
  console.error("✗ No plugin paired within the time limit — is it running and did you click Pair?");
  process.exit(1);
}
if (!bridge.selection) {
  console.error("✗ Plugin paired, but no selection arrived. Select a frame in Figma, then re-run.");
  process.exit(1);
}
console.log(
  `✓ Selection received: "${bridge.selection.nodeName}" from "${bridge.selection.fileName}".\n`,
);

const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
const server = createServer();
await server.connect(serverTransport);
const client = new Client({ name: "plumb-connect", version: "0.0.0" });
await client.connect(clientTransport);

const status = parse(await client.callTool({ name: "plumb_status", arguments: {} }));
console.log("plumb_status → plugin:", JSON.stringify(status.plugin));

const sel = parse(await client.callTool({ name: "plumb_selection", arguments: { depth: 2 } }));
console.log("\nplumb_selection (depth 2):");
console.log(JSON.stringify(sel, null, 2));

await client.close();
await server.close();

console.log("─".repeat(64));
if (sel.error) {
  console.error(`✗ plumb_selection error: ${sel.error}`);
  process.exit(1);
}
console.log(
  `✓ PASS: live plugin path works — "${sel.selection}" → ` +
    `${sel.meta?.nodeCount} nodes, ~${sel.meta?.estTokens} tokens. No token, no rate limit.`,
);
process.exit(0);
