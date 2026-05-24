# Troubleshooting

> **Arriving from another Figma MCP error?** If your agent surfaced a `Dev Mode MCP exceeded 25k token cap`, `6 tool calls per month limit`, `Framelink HTTP 429`, or `Variables API requires Enterprise plan` error, see **[Alternatives & migration](/alternatives)** — Plumb is designed to solve exactly those.

## Pairing fails / nothing happens after clicking *Pair with Plumb*

The plugin tries ports `31337` through `31341` in order. The bridge picks the first available port; the plugin scans the same range.

Check the bridge is running and which port it bound:

```bash
lsof -iTCP:31337 -iTCP:31338 -iTCP:31339 -iTCP:31340 -iTCP:31341 -sTCP:LISTEN
```

If nothing shows: your MCP client hasn't spawned `plumb-mcp` yet. The bridge only opens when the server starts. Verify your MCP config (`~/.claude/mcp.json` or equivalent) and reload the client.

If a port is held by another process: kill it, or let Plumb pick the next port — it'll auto-fall-back.

## *"Manifest error: Invalid value for allowedDomains"*

Figma rejects the plugin's `manifest.json`. Cause: an older version of the plugin you've sideloaded. Re-import from the latest:

```bash
echo "$(npm root -g)/plumb-mcp/figma-plugin/manifest.json"
```

In Figma: **Plugins → Development → Import plugin from manifest…**, pick that path.

## *"WebSocket connection to ws://localhost:… failed"* spamming the console

That's the plugin trying to auto-reconnect after the bridge exited. Harmless — happens when you close your MCP client between sessions. Reopen the client (or close the plugin) and the spam stops.

## `plumb_components` times out on a huge file

If you see `MCP error -32001: Request timed out` from a file with thousands of instances, the MCP client default (60 s) is too short for the parallel-batched `getMainComponentAsync` to finish. Bump your client's per-call timeout:

- Claude Code: `timeout` field in `mcp.json` (or via `MCP_TIMEOUT` env var, depending on version).
- Cursor: client-side setting.

We've validated 14,608 instances finishing well inside 240 s on a 2024 M-series Mac.

## Assets land but a few are missing

`plumb_assets` caps at 300 per call. For screens with more candidates, use `list: true` first to see the full manifest, then `ids: [...]` to pull a specific subset.

## "I can read the file but it's not the file I'm looking at"

The plugin streams whichever Figma file it last saw. If you switched files mid-session and the plugin is collapsed to the dot, click the dot to expand the panel and verify the file name shown. If it's wrong, close and re-launch the plugin from the new file.

## REST path returns 403 / 404

The `FIGMA_TOKEN` is wrong, expired, or doesn't have read access to the file's team. Mint a new read-only token at **figma.com → Settings → Security** and re-export it.

## Performance feels off

- `plumb_node` token estimates higher than expected: try a smaller `depth` (default is auto-fit-to-budget; passing `depth: 2` is a good starting point for big screens).
- `plumb_assets` slow: pass `list: true` first, then `ids: [...]` — exports only what you need.
- `plumb_verify` slow: pass `depth: 4` (cheaper PDS to fetch) and `rendered` containing only the elements you tagged with `data-plumb-id`.

## Reset everything

If Plumb gets into a weird state:

1. Close the Figma plugin.
2. `lsof -iTCP:31337-31341 -sTCP:LISTEN` and kill anything listening.
3. Restart your MCP client.
4. Reopen the plugin, re-pair.

The pairing state is stored in `figma.clientStorage`; clear it from inside the plugin panel if you need a fully clean slate.
