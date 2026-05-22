# Plumb (`plumb-mcp`)

Local, free, token-frugal Figma → code bridge for AI coding agents.
See [plan.md](./plan.md) for the full design.

> **Status: Milestone 1 — in progress (REST path).** Four MCP tools —
> `plumb_status`, `plumb_outline`, `plumb_node`, `plumb_tokens` — over the
> Figma REST path, plus the normalizer that turns raw Figma nodes into the
> compact **Plumb Design Spec (PDS)**. The plugin path is next.

## Try it

```bash
npm install
npm run build       # → dist/index.js  (npx-runnable stdio MCP server)
npm run prove       # run the normalizer on the bundled fixture
npm run smoke       # in-memory MCP handshake + tools/list
```

### Prove against the real export-employees frame

Copy `.env.example` to `.env` (gitignored) and fill it in — `npm run prove`
loads `.env` automatically. Or pass the vars inline.

```bash
cp .env.example .env       # then edit: FIGMA_TOKEN + PLUMB_FILE_KEY
npm run prove              # normalizer depth/token curve
npm run outline            # the file's pages and top-level frames
```

- `FIGMA_TOKEN` — a read-only Figma personal access token
  (figma.com → Settings → Security → personal access tokens).
- `PLUMB_FILE_KEY` — the string after `/design/` in the file URL.
- `PLUMB_NODE_ID` — defaults to `131:6950`.

With no token set, `prove` falls back to the bundled synthetic fixture so the
normalizer is still exercised end-to-end.

## MCP client config

```jsonc
{
  "mcpServers": {
    "plumb": {
      "command": "node",
      "args": ["<abs-path>/dist/index.js"],
      "env": { "FIGMA_TOKEN": "figd_xxx" }
    }
  }
}
```

Then ask your agent to call `plumb_node` with a `fileKey` + node `id`.

## Layout

| Path | Role |
|---|---|
| `src/figma/` | REST ingest + raw Figma node types |
| `src/normalize/` | raw nodes → PDS (token dedup, `el` handles, auto-layout → flex) |
| `src/tools/` | MCP tool definitions |
| `src/server.ts`, `src/index.ts` | MCP server + stdio bin entry |
| `scripts/` | `prove` (normalizer proof) and `smoke` (MCP handshake) |

MIT © Tathagat Maitray
