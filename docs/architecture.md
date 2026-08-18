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
  │  Semantic Graph pass → container-level role labels (nav/hero/footer/
  │    sidebar/card) on top of PDS, consumed by plumb_diff / plumb_audit /
  │    plumb_query's select:"role" / plumb_node's collapseRoles — see
  │    "Semantic layer" below
  │  Version-keyed cache with fit-to-budget normalisation
  │  Twenty-eight MCP tools exposed over stdio
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
- `pattern` — detected semantic role: `"button"` (leaf-level) or, since v0.14,
  `"nav"` / `"hero"` / `"footer"` / `"sidebar"` / `"card"` (container-level —
  see "Semantic layer" below)
- `children` (recursive), `more: N` if the node was clipped at the depth
  boundary, or `summary` + `more: N` if it was semantically collapsed
  (`plumb_node`'s `collapseRoles`)

## Semantic layer

A second pass, on top of the PDS the normalizer already built, adds
container-level role labels without changing the PDS wire shape: `nav` /
`hero` / `footer` / `sidebar` (direct children of the requested root, by
position + size) and `card` (repeat-group templates that are both a styled
surface and carry their own text). The classifier is deterministic and
conservative by design — every rule requires several structural signals to
line up, and a missing label costs nothing (the agent falls back to raw
geometry) while a wrong one would actively mislead, so silence is always
preferred over a guess.

Internally this runs as a small pipeline — `src/semantic/build.ts` turns the
finished PDS into a platform-agnostic graph (nodes + containment/repeat
edges), `src/semantic/enrichers/role.ts` classifies it, and the result is
projected back onto `pattern`. The graph isn't Figma-only: `src/semantic/
buildFromHtml.ts` builds the same shape from a live webpage's DOM
(`plumb_import_web`, headless Chrome, no Figma involved), and every
enricher/emitter below runs against either source unmodified — the concrete
proof the graph is genuinely platform-agnostic, not just designed to look
that way. Consumers:

- **`plumb_diff`** — semantic diff between two PDS snapshots ("the hero moved
  from (0, 0) to (0, 120)" instead of a JSON diff).
- **`plumb_audit`** — heuristic accessibility checks (text contrast, button
  touch-target size) that read role labels to know what to check.
- **`plumb_query`**'s `select: "role"` and **`plumb_node`**'s
  `collapseRoles` filter and compress by the same labels.
- **`plumb_import_web`** — extracts structure and roles from a live URL.
- **`plumb_emit_react`** (`src/emit/react.ts`) — deterministic, template-based
  React/JSX generation from the graph, working on a Figma-sourced OR an
  HTML-sourced graph with the same code.

See the (gitignored, local) `docs/ROADMAP-v0.14-design-intelligence.md` for
the full design rationale if you're working on this layer.

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
