/**
 * Live plugin test: start the bridge, wait for the real Figma plugin to pair
 * and stream its inventory, then exercise the M1.5 surface — plumb_outline,
 * plumb_node by name, plumb_assets — over MCP.
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
console.log("→ In Figma: run the Plumb plugin → click 'Pair with Plumb'.");
console.log("  (Paired plugins stream every screen — no selection required.)");
console.log("Waiting up to 5 minutes …\n");

const deadline = Date.now() + 300_000;
let announcedPair = false;
while (Date.now() < deadline) {
  if (bridge.paired && !announcedPair) {
    console.log(`✓ Plugin paired (v${bridge.pluginVersion ?? "?"}).`);
    announcedPair = true;
  }
  if (bridge.paired && bridge.inventory) break;
  await delay(500);
}
if (!bridge.paired) {
  console.error("✗ No plugin paired within the time limit.");
  process.exit(1);
}
if (!bridge.inventory) {
  console.error("✗ Plugin paired but did not stream the file inventory.");
  process.exit(1);
}

const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
const server = createServer();
await server.connect(serverTransport);
const client = new Client({ name: "plumb-connect", version: "0.0.0" });
await client.connect(clientTransport);

/* --- plumb_outline ------------------------------------------------------ */
const outline = parse(await client.callTool({ name: "plumb_outline", arguments: {} }));
const screens: Array<{ id: string; name: string; box?: { w: number; h: number } }> =
  (outline.pages ?? []).flatMap((p: any) => p.screens ?? []);

console.log(`\nplumb_outline → ${outline.meta?.screenCount} screen(s) in "${outline.file?.name}":`);
for (const s of screens.slice(0, 12)) {
  console.log(`   · ${s.name}  (${s.box?.w}×${s.box?.h})  [${s.id}]`);
}
if (screens.length > 12) console.log(`   … and ${screens.length - 12} more.`);

/* --- plumb_node by name ------------------------------------------------- */
const target = bridge.selection?.nodeName || screens[0]?.name || "";
if (!target) {
  console.error("\n✗ No screen to demo on.");
  process.exit(1);
}
console.log(`\nDemoing on: "${target}"`);

const node = parse(
  await client.callTool({ name: "plumb_node", arguments: { name: target, depth: 2 } }),
);
if (node.ambiguous) {
  console.log(`plumb_node → ambiguous: ${node.matches.length} screens named "${target}":`);
  for (const m of node.matches as Array<Record<string, any>>) {
    console.log(`   · [${m.id}]  ${m.name}  (${m.w}×${m.h}, page "${m.page}")`);
  }
} else if (node.error) {
  console.error(`plumb_node → ERROR: ${node.error}`);
} else {
  console.log(
    `plumb_node → ${node.meta?.nodeCount} nodes, ~${node.meta?.estTokens} tokens ` +
      `(depth ${node.meta?.depthUsed}).`,
  );
  console.log(
    `  tokens: ${Object.keys(node.tokens?.color ?? {}).length} colours, ` +
      `${Object.keys(node.tokens?.text ?? {}).length} text styles, ` +
      `${Object.keys(node.tokens?.radius ?? {}).length} radii, ` +
      `${Object.keys(node.tokens?.shadow ?? {}).length} shadows.`,
  );
}

/* --- plumb_assets ------------------------------------------------------- */
const assets = parse(
  await client.callTool({ name: "plumb_assets", arguments: { name: target } }),
);
if (assets.ambiguous) {
  console.log(`\nplumb_assets → ambiguous: ${assets.matches.length} screens.`);
} else if (assets.error) {
  console.error(`\nplumb_assets → ERROR: ${assets.error}`);
} else {
  console.log(`\nplumb_assets → ${assets.count} asset(s) → ${assets.dir}`);
  for (const a of (assets.assets ?? []).slice(0, 12) as Array<Record<string, any>>) {
    console.log(`   · ${a.name} (${a.format}, ${a.bytes}B) → ${a.path}`);
  }
  if ((assets.assets?.length ?? 0) > 12) {
    console.log(`   … and ${assets.assets.length - 12} more.`);
  }
}

/* --- plumb_screenshot --------------------------------------------------- */
const shot = parse(
  await client.callTool({ name: "plumb_screenshot", arguments: { name: target } }),
);
if (shot.error) {
  console.error(`\nplumb_screenshot → ERROR: ${shot.error}`);
} else if (shot.path) {
  console.log(
    `\nplumb_screenshot → ${shot.path}  (${shot.format}, ${shot.bytes}B at ${shot.scale}×)`,
  );
}

/* --- plumb_search ------------------------------------------------------- */
const found = parse(
  await client.callTool({ name: "plumb_search", arguments: { type: "INSTANCE" } }),
);
if (!found.error) {
  console.log(`\nplumb_search (type=INSTANCE) → ${found.count} match(es):`);
  for (const m of ((found.matches ?? []) as Array<Record<string, any>>).slice(0, 6)) {
    console.log(`   · ${m.name} [${m.type}] (${m.w}×${m.h}) on "${m.page}"  [${m.id}]`);
  }
  if ((found.matches?.length ?? 0) > 6) {
    console.log(`   … and ${found.matches.length - 6} more.`);
  }
}

/* --- plumb_components --------------------------------------------------- */
const comps = parse(
  await client.callTool({ name: "plumb_components", arguments: {} }),
);
if (!comps.error) {
  console.log(
    `\nplumb_components → ${comps.componentCount} component(s), ${comps.instanceCount} instance(s)`,
  );
  for (const c of ((comps.components ?? []) as Array<Record<string, any>>).slice(0, 6)) {
    console.log(
      `   · ${c.name}  (${c.w}×${c.h}, used ${c.instanceCount}×)  [${c.id}]`,
    );
  }
  if ((comps.components?.length ?? 0) > 6) {
    console.log(`   … and ${comps.components.length - 6} more.`);
  }
}

await client.close();
await server.close();
console.log("─".repeat(64));
console.log(
  "✓ PASS: live plugin path — inventory · by-name fetch · assets · screenshot · search · components.",
);
process.exit(0);
