/**
 * Live end-to-end test: drives the real MCP tools over an in-memory transport
 * against a real Figma file — exercising fit-to-budget and the response cache.
 * Reads .env (FIGMA_TOKEN, PLUMB_FILE_KEY, PLUMB_NODE_ID).
 */
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer } from "../src/server";
import { loadDotEnv } from "./_dotenv";

loadDotEnv(join(process.cwd(), ".env"));

const fileKey = process.env.PLUMB_FILE_KEY;
const nodeId = process.env.PLUMB_NODE_ID ?? "131:6950";
if (!process.env.FIGMA_TOKEN || !fileKey) {
  console.error("Set FIGMA_TOKEN and PLUMB_FILE_KEY (e.g. in .env) to run the live test.");
  process.exit(1);
}

// Fresh cache dir per run so the miss → hit transition is deterministic.
process.env.PLUMB_CACHE_DIR = join(tmpdir(), `plumb-live-${Date.now()}`);

function parse(res: unknown): Record<string, any> {
  const content = (res as { content?: { text?: string }[] }).content ?? [];
  return JSON.parse(content[0]?.text ?? "{}") as Record<string, any>;
}

const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
const server = createServer();
await server.connect(serverTransport);
const client = new Client({ name: "plumb-live", version: "0.0.0" });
await client.connect(clientTransport);

async function call(name: string, args: Record<string, unknown>): Promise<Record<string, any>> {
  const res = parse(await client.callTool({ name, arguments: args }));
  if (res.error) {
    console.error(`  ⚠ ${name} → ERROR: ${res.error}  (next: ${res.nextAction ?? "—"})`);
  }
  return res;
}

const budget = 10_000;

const outline = await call("plumb_outline", { fileKey });
console.log(`plumb_outline → ${outline.meta?.frameCount} frames, ~${outline.meta?.estTokens} tokens`);

const fitted = await call("plumb_node", { fileKey, id: nodeId, depth: 8, maxTokens: budget });
console.log(
  `plumb_node    → asked depth 8, maxTokens ${budget} → depthUsed ${fitted.meta?.depthUsed}, ` +
    `~${fitted.meta?.estTokens} tokens, cached=${fitted.cached}`,
);

const again = await call("plumb_node", { fileKey, id: nodeId, depth: 8, maxTokens: budget });
console.log(`plumb_node    → identical repeat call: cached=${again.cached}`);

const tokens = await call("plumb_tokens", { fileKey, id: nodeId });
console.log(
  `plumb_tokens  → ${Object.keys(tokens.tokens?.color ?? {}).length} colours, ` +
    `${Object.keys(tokens.tokens?.text ?? {}).length} text styles`,
);

await client.close();
await server.close();

console.log("─".repeat(64));
const fitOk = Boolean(
  fitted.meta && fitted.meta.estTokens <= budget && fitted.meta.depthUsed <= 8,
);
const cacheOk = again.cached === true;
if (!fitOk || !cacheOk) {
  console.error("✗ FAIL: see the ⚠ errors above.");
  process.exit(1);
}
console.log(
  `✓ PASS: fit-to-budget capped the response at depth ${fitted.meta.depthUsed} ` +
    `(~${fitted.meta.estTokens} <= ${budget}); the cache served the repeat call.`,
);
