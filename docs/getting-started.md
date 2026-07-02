---
title: Get started — Plumb Figma MCP server
description: Install the Plumb MCP server (npm), sideload the Figma plugin, configure Claude Code or Cursor or Windsurf, and pair in one click.
---

# Get started

Plumb has two halves that talk to each other on your local machine:

1. A small **MCP server** (`plumb-mcp`) — your AI coding agent connects to this.
2. A **Figma plugin** — runs inside the Figma desktop app, reads the file, replies to the server.

You'll install both, pair them once with a click, then everything else happens from your agent.

## Prerequisites

- **Node.js ≥ 20**
- **Figma desktop app** (the web app cannot sideload development plugins)
- An **MCP-compatible client** — Claude Code, Cursor, Windsurf, etc.

## 1 · Install the server

Pick whichever fits your setup:

```bash
# npm — global install (recommended)
npm install -g plumb-mcp

# npm — without installing
npx plumb-mcp

# Docker — multi-arch image (amd64 + arm64), runs on stdio
docker run --rm -i ghcr.io/tathagat22/plumb-mcp:latest

# Source — for contributors
git clone https://github.com/tathagat22/plumb-mcp.git
cd plumb-mcp && npm install && npm run build
```

Confirm it's reachable:

```bash
plumb-mcp --help     # prints the MCP server's tool list and exits, or
npx plumb-mcp        # runs the server on stdio
```

## 2 · Sideload the Figma plugin

The plugin ships inside the npm package. Find the manifest:

```bash
echo "$(npm root -g)/plumb-mcp/figma-plugin/manifest.json"
```

In Figma desktop: **Plugins → Development → Import plugin from manifest…** and select that file.

> Once the Figma Community submission is approved, you'll be able to install the plugin directly from the Community page and skip this step.

## 3 · Configure your MCP client

### Claude Code

Edit `~/.claude/mcp.json` (or your workspace's `.claude/mcp.json`):

```json
{
  "mcpServers": {
    "plumb": {
      "command": "npx",
      "args": ["plumb-mcp"]
    }
  }
}
```

### Cursor / Windsurf / other MCP clients

Same shape — point the client at `npx plumb-mcp` over stdio. Consult your client's MCP-server configuration docs for the exact field names.

## 4 · Pair the plugin

1. Open any Figma file.
2. Menu → **Plugins → Development → Plumb**.
3. The plugin opens a small panel. Click **Pair with Plumb**.
4. The panel collapses to a small dot. Pairing is remembered between sessions.

## 5 · Use it from your agent

In your MCP client, ask the agent something like:

> *List every screen in this Figma file.*

The agent will call `plumb_outline`. From there it can fetch any screen as a compact design spec, export assets, run pixel-accurate verification against code it builds, and so on.

The [tool reference](/tools/) covers each tool individually. The [recipes](/recipes) page collects common workflows.

### Generate a design from a prompt

That's the figma → code direction. Plumb goes the other way too: hand it a one-line brief and it becomes an **AI design director** — researching live reference sites, extracting a brand, and composing a full, on-brand Figma page, then critiquing its own render until it's good. No extra API key; the agent driving Plumb *is* the creative director.

> *Use plumb_studio to design a premium fintech dashboard, then screenshot it and run plumb_review until it clears the bar.*

See [Prompt to design](/prompt-to-design) for the full director walkthrough.

## What happens on disk

Two folders appear in your current working directory the first time the agent calls them:

- `./plumb-assets/<screen-name>/` — exported SVG icons and PNG images
- `./plumb-screenshots/` — full-fidelity screenshots

Override the locations with environment variables if you'd rather keep them elsewhere:

```bash
PLUMB_ASSETS_DIR=/path/to/assets
PLUMB_SCREENSHOTS_DIR=/path/to/screenshots
PLUMB_CACHE_DIR=/path/to/cache   # default ~/.cache/plumb/v1/
```

## Troubleshooting

If pairing doesn't take, see [troubleshooting](/troubleshooting). The two most common issues:

- Plugin can't reach the server → check `lsof -i:31337` and confirm no other process holds the loopback port.
- "Manifest error" on plugin load → make sure you imported the **`manifest.json`** file, not a folder or another file.
