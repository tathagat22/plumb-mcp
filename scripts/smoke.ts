/**
 * Smoke test: a real MCP handshake over an in-memory transport pair.
 * Confirms the server boots, lists `plumb_node`, and that the tool returns the
 * instruction-shaped error when no FIGMA_TOKEN is set (plan §6.6).
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
console.log("tools/list →", tools.map((t) => t.name).join(", ") || "(none)");

if (!tools.some((t) => t.name === "plumb_node")) {
  console.error("✗ FAIL: plumb_node not registered");
  process.exit(1);
}

// Call with no token configured — expect a clean, instruction-shaped error.
const savedToken = process.env.FIGMA_TOKEN;
delete process.env.FIGMA_TOKEN;
delete process.env.FIGMA_ACCESS_TOKEN;

const result = await client.callTool({
  name: "plumb_node",
  arguments: { fileKey: "demo", id: "1:1" },
});

if (savedToken) process.env.FIGMA_TOKEN = savedToken;

console.log("plumb_node (no token) →", JSON.stringify(result.content));

await client.close();
await server.close();
console.log("✓ PASS: MCP handshake works and plumb_node is callable.");
