# Plumb — Figma plugin

The companion plugin for the [Plumb](../README.md) MCP server. It reads your
current selection through the Figma Plugin API (no token, no rate limits) and
streams it to the local Plumb server over a localhost WebSocket.

## Build it

```bash
npm run build:plugin     # from the repo root → produces figma-plugin/code.js
```

## Sideload it (development)

1. Open the **Figma desktop app** (importing a local plugin is desktop-only).
2. **Plugins → Development → Import plugin from manifest…**
3. Choose `figma-plugin/manifest.json`.
4. Run **Plugins → Development → Plumb**. A small panel opens.

## Use it

1. Start the Plumb MCP server (your editor does this once configured).
2. In the plugin panel, click **Pair with Plumb** — the dot turns green.
3. Select a frame. The plugin streams it to the server automatically; your
   agent can now call `plumb_selection`.

Keep the panel open — closing it stops the plugin (minimize it instead).

## Notes

- Pairing is a one-time click; the server accepts a single paired plugin and
  binds loopback-only (127.0.0.1).
- Ports `31337–31341` are scanned; the server uses the first free one.
- If the WebSocket is blocked, confirm `networkAccess` in `manifest.json`
  covers the port the server printed on startup.
