---
title: MCP tool reference — Plumb Figma MCP server
description: Twelve Model Context Protocol tools that expose Figma to Claude Code, Cursor, Windsurf, and other AI coding agents. Outline, node, assets, screenshot, search, components, verify, and more.
---

# Tools

Plumb exposes **twelve** MCP tools. Each one has a focused, single responsibility — the agent composes them.

| Tool | What it does |
|---|---|
| [`plumb_status`](/tools/plumb_status) | Self-description, key legend, connection state. Call first. |
| [`plumb_outline`](/tools/plumb_outline) | Every screen in the file (id, name, size). |
| [`plumb_node`](/tools/plumb_node) | Extract a screen as compact PDS — by id or by name. |
| [`plumb_tokens`](/tools/plumb_tokens) | Design-token table (colours, type, radii, shadows). |
| [`plumb_selection`](/tools/plumb_selection) | The user's live Figma selection. |
| [`plumb_assets`](/tools/plumb_assets) | Export icons (SVG) + images (PNG) — three modes. |
| [`plumb_screenshot`](/tools/plumb_screenshot) | Render any node to PNG/JPG. |
| [`plumb_search`](/tools/plumb_search) | Find nodes by name and/or type. |
| [`plumb_components`](/tools/plumb_components) | List components + instance usages. |
| [`plumb_verify`](/tools/plumb_verify) | Diff your rendered layout against the design. |
| [`plumb_fig_outline`](/tools/plumb_fig_outline) | Headless: list every screen in a saved `.fig` file from disk. |
| [`plumb_fig_node`](/tools/plumb_fig_node) | Headless: fetch one node from a saved `.fig` file by id. |

## Tool selection

If you only remember three:

- **`plumb_outline`** — figure out which screens exist.
- **`plumb_node`** — get the design spec for one of them.
- **`plumb_verify`** — confirm your code matches.

The other seven are how the agent fills in the details — exports, screenshots, search, design tokens, and component awareness.

## How the agent picks paths

Most tools accept either `id` (canonical) or `name` (looked up against the live outline). Pass `id` whenever you have it; it's unambiguous. Names can be duplicated — Plumb handles that by returning a list of matches for the agent to disambiguate.

Tools that need design data auto-pick between the **plugin path** (instant, no rate limits, requires Figma open) and the **REST path** (headless, rate-limited, requires `FIGMA_TOKEN`). With the plugin paired, omit `fileKey`. For REST, pass `fileKey` + `id`.

The plugin-path tools — `plumb_outline`, `plumb_selection`, `plumb_assets`, `plumb_screenshot`, `plumb_search`, `plumb_components` — require the plugin paired and won't fall back to REST. The other tools (`plumb_node`, `plumb_tokens`, `plumb_verify`) work on both paths.
