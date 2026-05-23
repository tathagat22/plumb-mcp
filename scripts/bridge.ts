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
process.env.PLUMB_SCREENSHOTS_DIR = join(tmpdir(), `plumb-bridge-shots-${Date.now()}`);

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
  if (msg.t === "get-screenshot") {
    ws.send(
      JSON.stringify({
        t: "screenshot",
        reqId: msg.reqId,
        dataBase64: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).toString("base64"),
        format: (msg as any).format ?? "PNG",
        nodeName: "Test Screen",
        error: null,
      }),
    );
  }
  if (msg.t === "get-search") {
    ws.send(
      JSON.stringify({
        t: "search",
        reqId: msg.reqId,
        error: null,
        matches: [
          { id: "a1", name: "Primary Button", type: "INSTANCE", page: "Page 1", w: 120, h: 40 },
          { id: "a2", name: "Secondary Button", type: "INSTANCE", page: "Page 1", w: 120, h: 40 },
        ],
      }),
    );
  }
  if (msg.t === "get-components") {
    ws.send(
      JSON.stringify({
        t: "components",
        reqId: msg.reqId,
        error: null,
        components: [{ id: "c1", name: "Button", page: "Page 1", w: 120, h: 40, instanceCount: 2 }],
        instances: [
          { id: "a1", name: "Primary Button", componentId: "c1", page: "Page 1" },
          { id: "a2", name: "Secondary Button", componentId: "c1", page: "Page 1" },
        ],
      }),
    );
  }
  if (msg.t === "get-assets") {
    const list = (msg as any).list === true;
    const ids = Array.isArray((msg as any).ids) ? ((msg as any).ids as string[]) : undefined;
    let assets: any[];
    if (ids && ids.length > 0) {
      assets = ids.map((id) => ({
        id,
        name: `node-${id}`,
        format: "SVG",
        dataBase64: list ? "" : fakeSvg,
      }));
    } else if (list) {
      assets = [
        { id: "131:p1", name: "icon-a", format: "SVG", dataBase64: "" },
        { id: "131:p2", name: "icon-b", format: "SVG", dataBase64: "", parentId: "131:p1" },
      ];
    } else {
      assets = [{ id: "i1", name: "star icon", format: "SVG", dataBase64: fakeSvg }];
    }
    ws.send(JSON.stringify({ t: "assets", reqId: msg.reqId, error: null, assets }));
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
  "plumb_assets default mode writes asset files and returns paths",
  assets.source === "plugin" &&
    assets.count === 1 &&
    typeof assets.assets?.[0]?.path === "string" &&
    existsSync(assets.assets[0].path),
  assets.assets?.[0]?.path ?? "(no path)",
);

const listMode = parse(
  await client.callTool({
    name: "plumb_assets",
    arguments: { id: "131:6950", list: true },
  }),
);
check(
  "plumb_assets list mode returns a manifest without writing files",
  listMode.mode === "list" &&
    Array.isArray(listMode.manifest) &&
    listMode.count === 2 &&
    typeof listMode.manifest[0]?.id === "string",
  `${listMode.count} candidates, parentId: ${listMode.manifest?.[1]?.parentId ?? "(none)"}`,
);

const surgical = parse(
  await client.callTool({
    name: "plumb_assets",
    arguments: { ids: ["131:a1", "131:a2"] },
  }),
);
check(
  "plumb_assets surgical mode exports exactly the listed ids",
  surgical.mode === "specific" &&
    surgical.count === 2 &&
    typeof surgical.assets?.[0]?.path === "string" &&
    existsSync(surgical.assets[0].path),
  `${surgical.count} files`,
);

const shot = parse(
  await client.callTool({ name: "plumb_screenshot", arguments: { id: "131:6950" } }),
);
check(
  "plumb_screenshot writes a PNG and returns the path",
  typeof shot.path === "string" &&
    shot.format === "PNG" &&
    existsSync(shot.path) &&
    typeof shot.bytes === "number" &&
    shot.bytes > 0,
  shot.path,
);

const found = parse(
  await client.callTool({ name: "plumb_search", arguments: { query: "button" } }),
);
check(
  "plumb_search returns matches",
  found.count === 2 && Array.isArray(found.matches),
  `${found.count} matches`,
);

const comps = parse(
  await client.callTool({ name: "plumb_components", arguments: {} }),
);
check(
  "plumb_components returns components + instances",
  comps.componentCount === 1 && comps.instanceCount === 2,
  `${comps.componentCount} comp, ${comps.instanceCount} inst`,
);

/* --- plumb_verify ------------------------------------------------------- */
// Build a rendered layout that mostly matches the fixture but has three known
// discrepancies (width off, font size off, ghost element) so we can assert
// the verifier classifies each correctly.
const renderedOk = parse(
  await client.callTool({
    name: "plumb_verify",
    arguments: {
      id: "131:6950",
      rendered: [
        {
          el: "export-employees-dialog",
          box: { x: 0, y: 0, w: 528, h: 578 },
          styles: {
            backgroundColor: "rgb(247, 247, 251)",
            borderRadius: "21px",
            flexDirection: "column",
          },
        },
        {
          el: "title",
          box: { x: 20, y: 20, w: 220, h: 24 },
          text: "Export employees",
          styles: {
            color: "rgb(18, 18, 18)",
            fontWeight: "700",
            fontSize: "20px",
            lineHeight: "24px",
            fontFamily: "Inter, sans-serif",
          },
        },
      ],
    },
  }),
);
check(
  "plumb_verify on a matching layout returns ok with zero errors",
  renderedOk.ok === true && renderedOk.matched === 2 &&
    !renderedOk.deltas.some((d: any) => d.severity === "error"),
  `${renderedOk.matched} matched, ${renderedOk.deltas?.length ?? 0} deltas`,
);

const renderedBad = parse(
  await client.callTool({
    name: "plumb_verify",
    arguments: {
      id: "131:6950",
      rendered: [
        {
          el: "export-employees-dialog",
          box: { x: 0, y: 0, w: 540, h: 578 }, // w off by 12 — error
          styles: {
            backgroundColor: "rgb(255, 0, 0)", // very wrong colour — error
            borderRadius: "21px",
          },
        },
        {
          el: "title",
          box: { x: 20, y: 20, w: 220, h: 24 },
          text: "Export employees",
          styles: {
            color: "rgb(18, 18, 18)",
            fontWeight: "500", // off by 200 — error
            fontSize: "16px", // off by 4 — error
            lineHeight: "20px",
            fontFamily: "Inter",
          },
        },
        {
          el: "ghost-element", // doesn't exist in PDS — flagged
          box: { x: 0, y: 0, w: 100, h: 100 },
        },
      ],
    },
  }),
);
check(
  "plumb_verify catches size, colour, weight, font-size, and missing-in-pds",
  renderedBad.ok === false &&
    renderedBad.matched === 2 &&
    renderedBad.unmatched === 1 &&
    renderedBad.deltas.some((d: any) => d.kind === "size.w" && d.severity === "error") &&
    renderedBad.deltas.some((d: any) => d.kind === "fill" && d.severity === "error") &&
    renderedBad.deltas.some((d: any) => d.kind === "text.weight") &&
    renderedBad.deltas.some((d: any) => d.kind === "text.size" && d.severity === "error") &&
    renderedBad.deltas.some((d: any) => d.kind === "missing-in-pds"),
  `${renderedBad.deltas.length} deltas, unmatched=${renderedBad.unmatched}`,
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
