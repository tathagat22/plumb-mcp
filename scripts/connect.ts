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
/** Heavy tools (screenshot of a full screen, asset export of many icons) can
 *  take well over the MCP client's default 60s timeout. */
const HEAVY = { timeout: 240_000 };

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
// Pick a target that exists as a top-level screen and is unique by name so
// the by-name calls don't bail out with "no match" or "ambiguous".
const screenNames = screens.map((s) => s.name);
const nameCount = screenNames.reduce<Record<string, number>>((acc, n) => {
  acc[n] = (acc[n] ?? 0) + 1;
  return acc;
}, {});
const selectionIsScreen =
  bridge.selection?.nodeName &&
  nameCount[bridge.selection.nodeName] === 1;
const target = selectionIsScreen
  ? bridge.selection!.nodeName
  : screens.find((s) => nameCount[s.name] === 1)?.name ||
    screens[0]?.name ||
    "";
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
  await client.callTool(
    { name: "plumb_assets", arguments: { name: target } },
    undefined,
    HEAVY,
  ),
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
// Full 4× PNG — the binary upload path (POST /upload) ships raw bytes over
// loopback HTTP, so there's no longer a reason to ask for a downsized image.
const shot = parse(
  await client.callTool(
    { name: "plumb_screenshot", arguments: { name: target, scale: 4, format: "PNG" } },
    undefined,
    HEAVY,
  ),
);
if (shot.ambiguous) {
  console.log(
    `\nplumb_screenshot → ambiguous: ${shot.matches.length} screens named "${target}".`,
  );
} else if (shot.error) {
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
  await client.callTool({ name: "plumb_components", arguments: {} }, undefined, HEAVY),
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

/* --- plumb_verify ------------------------------------------------------- */
// Build a "rendered" layout straight from the live PDS — sizes match by
// construction. Should produce zero errors (the verifier must not see ghosts
// where there are none). Then break one element and add a ghost to prove it
// catches real mistakes too.
const pdsForVerify = parse(
  await client.callTool({ name: "plumb_node", arguments: { name: target, depth: 4 } }),
);
if (!pdsForVerify.error && pdsForVerify.nodes) {
  const renderedFromPds = Object.entries(pdsForVerify.nodes as Record<string, any>)
    .filter(([_, n]) => n.box && (n.box.w > 0 || n.box.h > 0))
    .slice(0, 40)
    .map(([el, n]) => ({ el, box: { x: 0, y: 0, w: n.box.w, h: n.box.h } }));

  const goodVerify = parse(
    await client.callTool(
      {
        name: "plumb_verify",
        arguments: { name: target, depth: 6, rendered: renderedFromPds },
      },
      undefined,
      HEAVY,
    ),
  );
  const goodErrors =
    (goodVerify.deltas ?? []).filter((d: any) => d.severity === "error").length;
  console.log(
    `\nplumb_verify (self-verify) → ${goodVerify.matched}/${renderedFromPds.length} matched, ` +
      `${goodErrors} errors, ok=${goodVerify.ok}`,
  );
  // If self-verify reports any deltas, surface them — the rendered came from
  // PDS, so any non-zero diff is a real signal about the verifier itself.
  for (const d of ((goodVerify.deltas ?? []) as Array<Record<string, any>>).slice(0, 4)) {
    const diff = d.diff !== undefined ? ` (diff ${d.diff})` : "";
    console.log(`    · [${d.severity}] ${d.kind} on "${d.el}": ${d.expected} → ${d.actual}${diff}`);
  }

  const broken = renderedFromPds.map((r, i) =>
    i === 0 ? { ...r, box: { ...r.box, w: r.box.w + 24 } } : r,
  );
  broken.push({ el: "definitely-not-a-real-el", box: { x: 0, y: 0, w: 1, h: 1 } });

  const badVerify = parse(
    await client.callTool(
      {
        name: "plumb_verify",
        arguments: { name: target, depth: 6, rendered: broken },
      },
      undefined,
      HEAVY,
    ),
  );
  const badErrors = (badVerify.deltas ?? []).filter(
    (d: any) => d.severity === "error",
  ).length;
  console.log(
    `plumb_verify (broken)      → ${badVerify.matched}/${broken.length} matched, ` +
      `${badVerify.unmatched} unmatched, ${badErrors} errors, ok=${badVerify.ok}`,
  );
  for (const d of ((badVerify.deltas ?? []) as Array<Record<string, any>>).slice(0, 4)) {
    const diff = d.diff !== undefined ? ` (diff ${d.diff})` : "";
    console.log(`    · [${d.severity}] ${d.kind} on "${d.el}": ${d.expected} → ${d.actual}${diff}`);
  }
}

await client.close();
await server.close();
console.log("─".repeat(64));
console.log(
  "✓ PASS: live plugin path — inventory · by-name · assets · screenshot · search · components · verify.",
);
process.exit(0);
