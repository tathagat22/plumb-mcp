# Plumb (`plumb-mcp`)

**A Model Context Protocol (MCP) server for Figma — used with Claude Code, Cursor, Windsurf, and any other MCP-compatible AI coding agent.**

📖 Full docs: **<https://tathagat22.github.io/plumb-mcp/>** &nbsp;·&nbsp; 📦 npm: [`plumb-mcp`](https://www.npmjs.com/package/plumb-mcp)

Plumb reads a Figma file through a companion plugin running inside the desktop
app — no REST rate limits, no metered billing, no plan gating. It returns a
compact, normalised design spec instead of the multi-hundred-thousand-token
JSON the Figma API emits, and exports SVG icons and PNG images to disk on
demand. Works on any Figma plan, including Free.

---

## Why Plumb

Plumb's pitch in one line: **biggest Figma MCP surface that works on any plan,
runs locally, and closes the design-to-code loop with structural verification.**

- **Figma's official Dev Mode MCP server** is plan-gated (6 tool calls/month
  on Starter), token-explodes on real screens (351,378 tokens observed
  against a 25k client cap), reported "85–90% wrong" on complex designs,
  needs the desktop app open with the right selection, and is metered.
- **Framelink (`figma-developer-mcp`)** has a small, mature surface — two
  tools (`get_figma_data`, `download_figma_images`) over Figma's REST API.
  Inherits REST rate limits, can't reach Variables on non-Enterprise plans,
  and offers no `plumb_verify`-style design-vs-code diff or live-selection
  awareness.

Plumb runs locally, reads through a companion plugin (no rate limits, on any
plan including Free), exposes twelve focused tools, and ships an offline
`.fig` parser for headless / CI use. Auto-layout is pre-resolved to flexbox,
design tokens are deduped, and `plumb_verify` returns structured deltas
between what the agent built and what's in Figma.

---

## Compare

If you've already tried other Figma MCP servers, here's the honest positioning.

| Capability | Plumb | Figma's Dev Mode MCP | Framelink | claude-talk-to-figma |
|---|---|---|---|---|
| Tools exposed | **12** | small | 2 | small |
| Works on Figma Free plan | ✅ | Limited | ✅ (no Variables) | ✅ |
| Reads via | Plugin · REST · `.fig` | REST | REST | Plugin |
| Plugin-path rate limit | **None** | n/a | n/a | None |
| Variables on non-Enterprise | ✅ via plugin | Limited | ❌ | ✅ |
| Writes back into Figma | ❌ | ✅ | ❌ | ✅ |
| Design-vs-code diff (`verify`) | ✅ | ❌ | ❌ | ❌ |
| Live `selection` awareness | ✅ | ✅ | ❌ | ✅ |
| Component / instance inventory | ✅ | partial | ❌ | partial |
| Offline `.fig` parse for CI | ✅ | ❌ | ❌ | ❌ |
| Token-frugal PDS (auto-layout→flex, deduped) | ✅ | ❌ | partial | ❌ |
| Local-only, zero telemetry | ✅ | cloud | ✅ | ✅ |
| Transport | stdio | stdio | stdio + HTTP/SSE | stdio |
| License | MIT | proprietary | MIT | MIT |

**Pick Plumb** for the widest surface on any plan and to verify your code
against the design. **Pick Framelink** if you need HTTP/SSE transport for
hosted MCP setups and only need raw layout data. **Pick the official Dev Mode
server** if your team is on Organization/Enterprise and you specifically need
agents to *write* into Figma.

---

## The twelve tools

| Tool | What it does |
|---|---|
| `plumb_status` | Self-description, key legend, connection state. Call first. |
| `plumb_outline` | Every screen in the file (id, name, size). |
| `plumb_node` | Extract a screen as compact PDS — by id or by name. |
| `plumb_tokens` | Design-token table (colours, type, radii, shadows). |
| `plumb_selection` | The user's live Figma selection. |
| `plumb_assets` | Export icons (SVG) + images (PNG) — three modes: recursive, list (manifest only), or surgical by ids. |
| `plumb_screenshot` | Render any node to PNG/JPG. |
| `plumb_search` | Find nodes by name and/or type. |
| `plumb_components` | List components + instance usages. |
| `plumb_verify` | Diff your rendered layout against the design — structured deltas, no pixel diff. |
| `plumb_fig_outline` | Headless: read a saved `.fig` file from disk and list every screen. No Figma desktop, no token. |
| `plumb_fig_node` | Headless: fetch one node from a saved `.fig` file by id. |

---

## Battle-tested

Run against a real, production-scale design file (a large internal product —
identity withheld):

| Metric | Result |
|---|---|
| Screens in inventory | **665** |
| Component definitions | **111** |
| Component instances enumerated | **14,608** |
| Assets exported from one screen (icons + images) | **106** |
| `plumb_assets` wall time (106 assets, ack-serialized) | **424 ms** |
| `plumb_screenshot` 4× PNG of a 1440×1045 frame | 1.0 MB |
| `plumb_node` PDS for a 31-node screen at depth 2 | **~1.7k tokens** |
| `plumb_verify` self-check (40 elements) | 40/40 matched, **0 errors** |

All seven plugin-path tools — outline · node · assets · screenshot · search ·
components · verify — passed end-to-end on the file. The earlier transport
choked Figma's IPC at this scale; the current binary-upload + per-asset-ack
path runs cleanly. See [the M3+ commit](https://github.com/tathagat22/plumb-mcp/commit/aef8c8b)
for the bug autopsy.

---

## Quick start

### Install the server

Pick whichever fits your stack:

```bash
# npm (recommended)
npm install -g plumb-mcp

# or run without installing
npx plumb-mcp

# or run as a container (multi-arch — amd64 + arm64)
docker run --rm -i ghcr.io/tathagat22/plumb-mcp:latest

# or build from source (for contributors)
git clone https://github.com/tathagat22/plumb-mcp.git
cd plumb-mcp && npm install && npm run build
```

### Sideload the Figma plugin

The plugin ships inside the npm package and the Docker image. Find the manifest:

```bash
echo "$(npm root -g)/plumb-mcp/figma-plugin/manifest.json"
```

1. Open Figma desktop → **Plugins → Development → Import plugin from manifest…**
2. Select the manifest path printed above.
3. Run **Plumb** from the Plugins menu. The panel opens — click **Pair with Plumb**.
4. The plugin remembers the pairing — future runs start as a small dot.

**Wire Plumb into your editor:**

```bash
node dist/index.js init
```

`plumb init` detects Claude Code / Cursor / VS Code / Windsurf and writes the
correct MCP config in each (`mcpServers` vs `servers` keyed appropriately;
existing servers are preserved, not clobbered).

---

## The agent's flow

```js
// 1. See what's in the file (no token needed, plugin path)
plumb_outline()
// → { pages: [{ name, screens: [{ id, el, name, box }] }] }

// 2. Extract a screen by name
plumb_node({ name: "Settings" })
// → { tokens: {...}, nodes: { ... PDS ... }, source: "plugin" }

// 3. Peek at every available asset cheaply (no downloads, no base64 on the wire)
plumb_assets({ name: "Settings", list: true })
// → { manifest: [{ id, name, format, parentId }], count: 41 }

// 4. Pull only the assets you need
plumb_assets({ ids: ["131:6900", "131:6905"] })
// → { dir: "plumb-assets/specific", assets: [{ id, name, path, format, bytes }] }

// 5. Optional: a visual reference
plumb_screenshot({ name: "Settings" })
// → { path: "plumb-screenshots/settings.png", bytes, scale }

// 6. Build the UI — tag each element data-plumb-id="<el>" using the el from PDS

// 7. Verify what you built — structural diff, no pixel comparison
const rendered = Array.from(document.querySelectorAll("[data-plumb-id]")).map((el) => {
  const r = el.getBoundingClientRect();
  const s = getComputedStyle(el);
  return {
    el: el.dataset.plumbId,
    box: { x: r.x, y: r.y, w: r.width, h: r.height },
    text: el.textContent?.trim(),
    styles: {
      backgroundColor: s.backgroundColor, color: s.color,
      fontFamily: s.fontFamily, fontSize: s.fontSize,
      fontWeight: s.fontWeight, lineHeight: s.lineHeight,
      paddingTop: s.paddingTop, paddingRight: s.paddingRight,
      paddingBottom: s.paddingBottom, paddingLeft: s.paddingLeft,
      gap: s.gap, flexDirection: s.flexDirection,
      justifyContent: s.justifyContent, alignItems: s.alignItems,
      borderRadius: s.borderRadius, borderColor: s.borderColor,
      borderWidth: s.borderWidth, opacity: s.opacity,
    },
  };
});
plumb_verify({ name: "Settings", rendered })
// → { ok, matched, deltas: [{ kind, expected, actual, severity }], next }
```

---

## Two data paths

| | Plugin (primary) | REST (secondary, headless) |
|---|---|---|
| Rate-limited | **No.** Reads the in-memory document. | Yes. Free/Starter workspaces get very low budgets. |
| Token required | No. | Yes — `FIGMA_TOKEN` (figma.com → Settings → Security). |
| Variables | **Yes**, even on Free plans. | No — Variables REST API is Enterprise-only. |
| Headless / CI | No (needs Figma open). | Yes. |

Tools auto-pick the path. With the plugin paired, omit `fileKey` and pass
`id` or `name`. For the REST path, pass `fileKey` + `id`.

---

## Architecture

```
Figma (desktop or browser, any plan)
  │
  │  Plumb plugin
  │    • reads document + variables (Figma Plugin API, no rate limits)
  │    • one-time "Pair with Plumb" click; collapses to a dot
  ▼
  ws://127.0.0.1:31337    JSON control channel (paired, Origin-aware)
   +   /upload/:key.:ext  loopback HTTP for binary blobs — screenshots,
                          assets — POSTed straight to disk, no base64,
                          per-item ack for array uploads to keep Figma's
                          IPC from buffering and redelivering
  ▼
Plumb MCP server  —  `npx plumb-mcp` / `node dist/index.js`
  │  • REST + plugin ingest
  │  • Normalizer → Plumb Design Spec (PDS):
  │      auto-layout → flexbox, tokens deduped, depth-stable `el` handles
  │      (mints handles in a full pre-walk so the same node gets the same
  │       el regardless of the requested depth — `plumb_verify` needs this)
  │  • Version-keyed cache, fit-to-budget (maxTokens → auto-depth)
  │  • Twelve MCP tools (status / outline / node / tokens / selection /
  │    assets / screenshot / search / components / verify /
  │    fig_outline / fig_node)
  ▼
  stdio MCP
  ▼
Claude Code · Cursor · VS Code · Windsurf
```

---

## Configuration

`.env` (gitignored — never commit secrets):

```bash
FIGMA_TOKEN=figd_your_read_only_token   # REST path only
PLUMB_FILE_KEY=…                        # for `npm run outline` etc.
PLUMB_NODE_ID=131:6950                  # demo target
```

Cache and outputs:

- **Cache** — `~/.cache/plumb/v1/` (TTL'd; override with `PLUMB_CACHE_DIR`).
- **Assets** — `./plumb-assets/<screen>/` (override with `PLUMB_ASSETS_DIR`).
- **Screenshots** — `./plumb-screenshots/` (override with `PLUMB_SCREENSHOTS_DIR`).

---

## Testing

```bash
npm run typecheck   # strict TS (server + plugin)
npm run build       # bundle server + plugin
npm run smoke       # MCP handshake; expects 12 tools
npm run check       # offline fit-to-budget + cache verification
npm run bridge      # simulated plugin + every tool offline
npm run prove       # normalizer depth/token curve (fixture or live)
npm run outline     # live: list every screen in your file (needs .env)
npm run connect     # live end-to-end against a paired plugin
```

---

## Layout

```
plumb-mcp/
├── src/
│   ├── index.ts          # bin entry: stdio MCP server + bridge
│   ├── server.ts         # registers the twelve tools
│   ├── verify.ts         # the plumb_verify comparison engine
│   ├── cache.ts          # on-disk version-keyed result cache
│   ├── assets.ts         # writes exported assets to disk
│   ├── pds.ts            # Plumb Design Spec types
│   ├── keylegend.ts      # the compact-key legend (self-description)
│   ├── meta.ts           # server name + version
│   ├── errors.ts         # instruction-shaped error payloads
│   ├── figma/            # REST ingest + raw Figma types
│   ├── bridge/           # localhost WebSocket bridge to the plugin
│   ├── normalize/        # raw Figma → PDS (handles, layout, paint, …)
│   ├── tools/            # the twelve MCP tools (one file each)
│   ├── cli/init.ts       # `plumb init` — write editor MCP configs
│   └── util/             # round, estimateTokens, …
├── figma-plugin/
│   ├── manifest.json
│   ├── code.ts           # main thread — reads, serializes, exports
│   └── ui.html           # the panel (dot + pair button)
├── scripts/              # smoke · check · bridge · connect · prove · outline
└── README.md             # you are here
```

---

## Security

- Loopback-only WebSocket bridge.
- Single paired plugin at a time; pairing is a deliberate click in the plugin
  panel (one-time, then remembered via `figma.clientStorage`).
- Zero telemetry.
- No personal-access token needed for the plugin path; the REST path's token
  is consumed only by the server's own outbound `fetch` calls.

---

## License

MIT © Tathagat Maitray. See [`LICENSE`](./LICENSE).
