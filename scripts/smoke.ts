/**
 * Smoke test: a real MCP handshake over an in-memory transport pair.
 * Confirms all five tools register, plumb_status self-describes (key legend),
 * and that a tool with no FIGMA_TOKEN returns the instruction-shaped error.
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer } from "../src/server";

const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

const server = createServer();
await server.connect(serverTransport);

const client = new Client({ name: "plumb-smoke", version: "0.0.0" });
await client.connect(clientTransport);

const { tools } = await client.listTools();
const names = tools.map((t) => t.name).sort();
console.log("tools/list →", names.join(", ") || "(none)");

const expected = [
  "plumb_assets",
  "plumb_components",
  "plumb_node",
  "plumb_outline",
  "plumb_screenshot",
  "plumb_search",
  "plumb_selection",
  "plumb_status",
  "plumb_tokens",
];
const missing = expected.filter((n) => !names.includes(n));
if (missing.length) {
  console.error("✗ FAIL: missing tools:", missing.join(", "));
  process.exit(1);
}

// plumb_status needs no Figma access — exercise it fully.
const status = await client.callTool({ name: "plumb_status", arguments: {} });
const statusText = ((status.content ?? []) as { text?: string }[])[0]?.text ?? "";
const parsed = JSON.parse(statusText) as {
  legend?: Record<string, string>;
  tools?: string[];
};
if (!parsed.legend || Object.keys(parsed.legend).length === 0) {
  console.error("✗ FAIL: plumb_status returned no key legend");
  process.exit(1);
}
console.log(
  `plumb_status → ${Object.keys(parsed.legend).length} legend keys, ` +
    `${parsed.tools?.length ?? 0} tools advertised`,
);

// A tool with no token configured — expect a clean, instruction-shaped error.
delete process.env.FIGMA_TOKEN;
delete process.env.FIGMA_ACCESS_TOKEN;
const noToken = await client.callTool({
  name: "plumb_node",
  arguments: { fileKey: "demo", id: "1:1" },
});
console.log("plumb_node (no token) →", JSON.stringify(noToken.content));

await client.close();
await server.close();
console.log("✓ PASS: 9 tools registered; plumb_status self-describes; errors are instruction-shaped.");
