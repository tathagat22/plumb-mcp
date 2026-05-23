# Architecture

Plumb is a two-process system bridged by loopback networking. Everything stays on your machine.

## Data flow

```
Figma (desktop or browser, any plan)
  │
  │  Plumb plugin (Figma Plugin API — no rate limits, all variables visible)
  │    Pairing: one click on "Pair with Plumb"; remembered via figma.clientStorage.
  │    The plugin's UI iframe is the network endpoint that talks to the server.
  ▼
  ws://localhost:31337    JSON control channel (paired, Origin-aware)
   +  /upload/:key.:ext   Loopback HTTP for binary blobs — screenshots and
                          exported icons/images. POSTed straight to disk by
                          the bridge. No base64 over the wire.
                          Array uploads use per-item ack so Figma's IPC
                          can't buffer + redeliver postMessages.
  ▼
Plumb MCP server  (`npx plumb-mcp` / `node dist/index.js`)
  │  REST + plugin ingest
  │  Normalizer → Plumb Design Spec (PDS):
  │    • auto-layout resolved to flexbox
  │    • design tokens (colour, type, radii, shadow) deduped into a table
  │    • depth-stable `el` handles minted in a full pre-walk
  │      (so the same node gets the same el regardless of requested depth —
  │       plumb_verify depends on this)
  │  Version-keyed cache with fit-to-budget normalisation
  │  Ten MCP tools exposed over stdio
  ▼
  stdio MCP
  ▼
Claude Code · Cursor · Windsurf · any MCP-compatible client
```

## Two data paths

| | Plugin (primary) | REST (secondary, headless) |
|---|---|---|
| Rate-limited | **No.** Reads the in-memory document. | Yes — Free/Starter workspaces get very low budgets. |
| Token required | No. | Yes — `FIGMA_TOKEN` (figma.com → Settings → Security). |
| Variables | **Yes**, even on Free plans. | No — Variables REST API is Enterprise-only. |
| Headless / CI | No (needs Figma open). | Yes. |

Tools auto-pick the path. With the plugin paired, omit `fileKey` and pass `id` or `name`. For the REST path, pass `fileKey` + `id`.

## Why loopback HTTP for binary payloads?

The plugin and the server share a machine. Base64-encoding a multi-megabyte PNG into JSON and shipping it over WebSocket is wasteful — and at scale (100+ icon exports), Figma's `figma.ui.postMessage` IPC starts buffering and **redelivering** the same `Uint8Array` two or three times. We discovered this experimentally; the workaround is:

- One small **WebSocket** channel for JSON control messages (which screen, which assets, here's the manifest).
- A separate **loopback HTTP** channel for the raw bytes — one POST per blob, written straight to a temp file.
- For array payloads (assets), the plugin **waits for an `upload-ack`** from the UI iframe before exporting the next asset. One blob in flight at a time. No IPC pileup, no redelivery.

This dropped a 30-second-with-duplicates run to **~600 ms** for 106 assets and is the reason `plumb_assets` scales to large design systems.

## PDS — the Plumb Design Spec

When the agent asks for a screen, the server returns a compact JSON shape with three top-level keys:

```jsonc
{
  "tokens": { /* colour, type, radii, shadow tables */ },
  "nodes":  { /* el-keyed map of normalised nodes */ },
  "meta":   { /* nodeCount, estTokens, depthUsed */ }
}
```

Each node carries:

- `el` — stable handle (depth-independent — see below)
- `id`, `name`, `type`
- `box: { w, h }`
- `layout` — flexbox-shaped if the Figma node uses auto-layout (`flow`, `gap`, `pad`, `justify`, `align`)
- `fill` / `stroke` / `radius` / `shadow` — token references (`$cBrand`, `$r0`, `$s1`) into the tokens table
- `text` — `$t` reference and `chars` for TEXT nodes
- `children` (recursive) or `more: N` if the node was clipped at the depth boundary

### Stable element handles

`el` is **not** the Figma node id (`101:870`). It's a slug like `"vector"`, `"vector-2"`, derived from the node name. We mint these in a full-tree pre-walk before emitting the depth-limited spec, so the same physical node gets the same `el` regardless of how deep the agent requested.

This matters because `plumb_verify` joins the live spec against what the agent rendered using `el` as the key. If a deeper walk shifted which actual node owned the name `"vector"`, verify would produce ghost deltas. The pre-walk makes that impossible.

## On-disk layout

```
./plumb-assets/<screen-name>/    # exported SVG icons + PNG images
./plumb-screenshots/             # full-fidelity screenshots
~/.cache/plumb/v1/               # version-keyed PDS cache (REST path)
```

Override with `PLUMB_ASSETS_DIR`, `PLUMB_SCREENSHOTS_DIR`, `PLUMB_CACHE_DIR`.
