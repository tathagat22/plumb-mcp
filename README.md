

<p align="center">
  <img src="./docs/public/banner.png" alt="Plumb — Figma ↔ AI coding, plumbed." width="100%">
</p>

# Plumb (`plumb-mcp`)

**The Figma → code MCP with a verification loop.** Designs go in, normalised specs come out, and `plumb-mcp verify` drives headless Chrome to prove your rendered code actually matches what's in Figma.

📖 Full docs: **<https://tathagat22.github.io/plumb-mcp/>** &nbsp;·&nbsp; 📦 npm: [`plumb-mcp`](https://www.npmjs.com/package/plumb-mcp) &nbsp;·&nbsp; 🇨🇳 [简体中文](./README.zh-cn.md) &nbsp;·&nbsp; 🇯🇵 [日本語](./README.ja.md) &nbsp;·&nbsp; 🇰🇷 [한국어](./README.ko.md)

<p align="center">
  <a href="cursor://anysphere.cursor-deeplink/mcp/install?name=plumb&config=eyJjb21tYW5kIjoibnB4IiwiYXJncyI6WyIteSIsInBsdW1iLW1jcCJdfQ=="><img src="https://cursor.com/deeplink/mcp-install-dark.svg" alt="Add to Cursor" height="32"></a>
  &nbsp;
  <a href="https://insiders.vscode.dev/redirect/mcp/install?name=plumb&config=%7B%22type%22%3A%22stdio%22%2C%22command%22%3A%22npx%22%2C%22args%22%3A%5B%22-y%22%2C%22plumb-mcp%22%5D%7D"><img src="https://img.shields.io/badge/Install_in_VS_Code-0098FF?style=for-the-badge&logo=visualstudiocode&logoColor=white" alt="Install in VS Code" height="32"></a>
</p>

Built for coding agents — Claude Code, Cursor, Windsurf, anything MCP-compatible. Reads Figma through a desktop-app plugin (no REST rate limits, works on every plan including Free), returns a compact normalised spec instead of the multi-hundred-thousand-token JSON the Figma API emits, and exports SVG icons + PNG images straight to disk.

---

## How plumb is different

Three other Figma MCP servers worth knowing:

- **Figma's official Dev Mode MCP** — bidirectional, but plan-gated and metered.
- **Framelink** — thin REST wrapper. Two tools. No verification, inherits rate limits.
- **cursor-talk-to-figma** — bidirectional automation for designers working *in* Figma.

Plumb is the only one that **closes the loop on code.** `plumb_verify` tells you whether the code your agent shipped actually matches the design — colour-coded deltas, no pixel diff, runs in CI. And `plumb_fit` turns that into a **self-healing loop**: it scores the build 0–100, hands back the exact deltas to fix, and the agent iterates until it's pixel-perfect.

Run the loop three ways:

- **In your editor** — `plumb_fit` (MCP). Claude Code / Cursor build, call it, and self-correct. Free; the agent is the generator.
- **From the terminal** — `plumb-mcp fit <figma-url>` generates a build, renders it headless in your Chrome, diffs, and corrects it pass-by-pass until it matches. (Needs `ANTHROPIC_API_KEY`.)
- **In the browser** — the [Playground](https://tathagat22.github.io/plumb-mcp/play/): paste a Figma URL or pick a demo and watch it converge, with your own key. No install, no backend.

---

## Are you hitting one of these?

If your agent landed here from an error, Plumb probably solves it.

| Error you're seeing | Why Plumb fixes it |
|---|---|
| `Figma Dev Mode MCP exceeded the 25k token cap` · `351,378 tokens observed` | PDS dedups design tokens (`$c1`, `$t1` …) and pre-resolves auto-layout to flexbox. A 178-node dialog comes back at ~2.6k tokens. |
| `Dev Mode MCP: 6 tool calls per month limit` · `Starter plan tool-call limit reached` | Plumb's plugin path has no per-call quota on any plan, including Free. |
| `Framelink figma-developer-mcp HTTP 429` · `Figma REST API rate limit exceeded` | The plugin path doesn't touch REST. Zero rate limits. |
| `Variables API requires Enterprise plan` · `403 Forbidden on variables` | Plumb reads Variables through the Figma Plugin API — works on every plan. |
| `Figma MCP returned 85% wrong layout` · hallucinated structure | Plumb returns structured PDS (not parsed prose) and ships `plumb_verify` + a `plumb-mcp verify` CLI that diff your rendered DOM against the design. |
| `Dev Mode MCP requires selection` · "Open desktop app with the right selection" | Plumb streams the whole file inventory the moment the plugin pairs. No per-call selection dance. |

Install: `npm install -g plumb-mcp` → `plumb-mcp init`.

---

## Quick start

```bash
# 1. Install
npm install -g plumb-mcp

# 2. Wire into your editor — auto-detects Claude Code / Cursor / VS Code / Windsurf
plumb-mcp init

# 3. Sideload the Figma plugin (one-time). Find the manifest:
echo "$(npm root -g)/plumb-mcp/figma-plugin/manifest.json"
#    Figma desktop → Plugins → Development → Import plugin from manifest…
#    Run Plumb → click "Pair with Plumb" → done. Future runs collapse to a dot.

# 4. Optional — verify rendered code against Figma from the terminal
plumb-mcp verify http://localhost:5173/dashboard --url <figma-url>

# …or let it build + self-correct to pixel-perfect on its own (BYO Anthropic key)
plumb-mcp fit <figma-url>
```

Other install paths: `npx plumb-mcp` · `docker run --rm -i ghcr.io/tathagat22/plumb-mcp:latest` · [build from source](https://github.com/tathagat22/plumb-mcp).

---

## The fifteen MCP tools

| Tool | What it does |
|---|---|
| `plumb_status` | Self-description, key legend, connection state. Call first. |
| `plumb_outline` | Every screen in the file (id, name, size). |
| `plumb_node` | Extract a screen as compact PDS — by id or by name. |
| `plumb_query` | Pull a slice (`skeleton` / `buttons` / `text` / `components`) when a full screen would blow the token budget. |
| `plumb_describe` | Text-only visual description — per-region narrative + child summary, for image-blind harnesses. |
| `plumb_tokens` | Design-token table (colours, type, radii, shadows). |
| `plumb_selection` | The user's live Figma selection. |
| `plumb_assets` | Export icons (SVG) + images (PNG) — three modes: recursive, list (manifest only), or surgical by ids. |
| `plumb_screenshot` | Render any node to PNG/JPG. |
| `plumb_search` | Find nodes by name and/or type. |
| `plumb_components` | List components + instance usages. |
| `plumb_verify` | Diff your rendered layout against the design — structured deltas with ΔE2000 perceptual colour distance, shadow/rotation/flex-child/fill-stack checks, no pixel diff. |
| `plumb_fit` | The self-healing loop: `plumb_verify` plus a 0–100 convergence score and prioritised fixes, so the agent iterates to pixel-perfect instead of one-shot checking. |
| `plumb_fig_outline` | Headless: read a saved `.fig` file from disk and list every screen. No Figma desktop, no token. |
| `plumb_fig_node` | Headless: fetch one node from a saved `.fig` file by id. |

---

## The agent's flow

```js
plumb_outline()                                  // 1. list screens
plumb_node({ name: "Settings" })                 // 2. extract PDS
plumb_assets({ name: "Settings", ids: [...] })   // 3. pull only the icons you need
// 4. Build the UI — tag each element data-plumb-id="<el>" using the el from PDS
plumb_fit({ name: "Settings", rendered })        // 5. score it, fix the deltas, repeat
// 6. ...until plumb_fit returns done:true — pixel-perfect
```

`plumb_fit` is `plumb_verify` plus a convergence target — use it to iterate to a match. For a one-shot check, call `plumb_verify` instead. For the `rendered` payload shape, see [the verify docs](https://tathagat22.github.io/plumb-mcp/tools/plumb_verify.html) — or skip the in-browser capture entirely and use the `plumb-mcp verify` / `plumb-mcp fit` CLIs to drive headless Chrome end-to-end.

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
  │  • Fifteen MCP tools (status / outline / node / query / describe /
  │    tokens / selection / assets / screenshot / search / components /
  │    verify / fit / fig_outline / fig_node)
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
npm run smoke       # MCP handshake; expects 15 tools
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
│   ├── server.ts         # registers the fifteen tools
│   ├── verify.ts         # the plumb_verify comparison engine
│   ├── fit.ts            # the convergence score + self-healing coaching
│   ├── cache.ts          # on-disk version-keyed result cache
│   ├── assets.ts         # writes exported assets to disk
│   ├── pds.ts            # Plumb Design Spec types
│   ├── keylegend.ts      # the compact-key legend (self-description)
│   ├── meta.ts           # server name + version
│   ├── errors.ts         # instruction-shaped error payloads
│   ├── figma/            # REST ingest + raw Figma types
│   ├── bridge/           # localhost WebSocket bridge to the plugin
│   ├── normalize/        # raw Figma → PDS (handles, layout, paint, …)
│   ├── tools/            # the fifteen MCP tools (one file each)
│   ├── fit/              # autonomous `plumb fit` loop — generate + serve
│   ├── render/           # shared headless / browser DOM capture
│   ├── cli/init.ts       # `plumb init` — write editor MCP configs
│   ├── cli/fit.ts        # `plumb fit` — self-healing build loop
│   └── util/             # round, estimateTokens, …
├── figma-plugin/
│   ├── manifest.json
│   ├── code.ts           # main thread — reads, serializes, exports
│   └── ui.html           # the panel (dot + pair button)
├── playground/           # the browser self-healing loop (Vite SPA, BYO-key)
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
[![MseeP.ai Security Assessment Badge](https://mseep.net/pr/tathagat22-plumb-mcp-badge.png)](https://mseep.ai/app/tathagat22-plumb-mcp)
## License

MIT © Tathagat Maitray. See [`LICENSE`](./LICENSE).
