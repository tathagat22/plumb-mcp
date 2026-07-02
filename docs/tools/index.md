---
title: "MCP tool reference — Plumb Figma MCP server (design→code + prompt→design)"
description: "Twenty Model Context Protocol tools that make Figma two-way for AI coding agents. Read direction — figma to code: outline, node, query, describe, assets, screenshot, verify, and the self-healing fit loop. Write direction — prompt to design: studio, brand, design, review, source. The AI design director, no extra API key."
---

# Tools

Plumb exposes **twenty** MCP tools, split across the two directions it plumbs — **Figma → code** (read) and **prompt → design** (write). Each one has a focused, single responsibility; the agent composes them.

## Read — Figma → code

Extract a design as a compact spec, build it, then diff the render against the design and self-heal to a pixel-perfect match.

| Tool | What it does |
|---|---|
| [`plumb_status`](/tools/plumb_status) | Self-description, key legend, connection state. Call first. |
| [`plumb_outline`](/tools/plumb_outline) | Every screen in the file (id, name, size). |
| [`plumb_node`](/tools/plumb_node) | Extract a screen as compact PDS — by id or by name. |
| [`plumb_query`](/tools/plumb_query) | Pull a slice of a screen by pattern (`skeleton` / `buttons` / `text` / `components`) when the full tree would blow the token budget. |
| [`plumb_describe`](/tools/plumb_describe) | Text-only visual description — per-region narrative + child summary, for image-blind harnesses or token-conscious flows. |
| [`plumb_tokens`](/tools/plumb_tokens) | Design-token table (colours, type, radii, shadows). |
| [`plumb_selection`](/tools/plumb_selection) | The user's live Figma selection. |
| [`plumb_assets`](/tools/plumb_assets) | Export icons (SVG) + images (PNG) — three modes. |
| [`plumb_screenshot`](/tools/plumb_screenshot) | Render any node to PNG/JPG. |
| [`plumb_search`](/tools/plumb_search) | Find nodes by name and/or type. |
| [`plumb_components`](/tools/plumb_components) | List components + instance usages. |
| [`plumb_verify`](/tools/plumb_verify) | Diff your rendered layout against the design — ΔE2000 colour distance, shadow/rotation/flex-child/fill-stack checks. |
| [`plumb_fit`](/tools/plumb_fit) | The self-healing loop: `plumb_verify` plus a 0–100 convergence score and prioritised fixes, so the agent iterates to pixel-perfect instead of one-shot checking. |
| [`plumb_fig_outline`](/tools/plumb_fig_outline) | Headless: list every screen in a saved `.fig` file from disk. |
| [`plumb_fig_node`](/tools/plumb_fig_node) | Headless: fetch one node from a saved `.fig` file by id. |

## Write — prompt → design (the director)

Turn a one-line brief into a full, on-brand Figma design: research real reference sites, extract a brand, compose the page from real nodes, then critique the render and iterate — with **no extra API key**, because the agent driving the MCP server is the creative director.

| Tool | What it does |
|---|---|
| [`plumb_studio`](/tools/plumb_studio) | **The design director.** One brief → researched references → extracted brand → a full composed Figma page (nav, hero, features, gallery, CTA, footer). Returns the node ids + authored spec so you can critique and refine. |
| [`plumb_brand`](/tools/plumb_brand) | Brief → live-screenshots best-in-class reference sites + a synthesized brand palette / type board (real Figma Variables + text styles) on the canvas. |
| [`plumb_design`](/tools/plumb_design) | Author a design from Plumb's high-level Design DSL and build it into Figma — full control over pages, sections, blocks, and brand tokens. The refine step of the loop (`mode:"sync"`). |
| [`plumb_review`](/tools/plumb_review) | The critique loop — the mirror of `plumb_fit`. Blends a structural diff, a deterministic design rubric, and the calling agent's own vision verdict into one score + ranked fixes. |
| [`plumb_source`](/tools/plumb_source) | Resolve on-brief assets (icons, photos, avatars, illustrations, patterns) for a design — ranked candidates or a downloaded best match. |

## Tool selection

If you only remember three per direction:

**Read (design → code):**

- **`plumb_outline`** — figure out which screens exist.
- **`plumb_node`** — get the design spec for one of them.
- **`plumb_fit`** — build it, then iterate to a pixel-perfect match (or `plumb_verify` for a one-shot check).

**Write (prompt → design):**

- **`plumb_studio`** — a brief becomes a full, on-brand Figma page in one call.
- **`plumb_review`** — screenshot the build, grade it yourself, and get a ranked fix list.
- **`plumb_design`** — apply those fixes with `mode:"sync"` and loop until `done`.

The rest are how the agent fills in the details — exports, screenshots, search, design tokens, component awareness, sliced queries for dense screens, text descriptions for image-blind harnesses, brand research, and asset sourcing.

## How the agent picks paths

Most read tools accept either `id` (canonical) or `name` (looked up against the live outline). Pass `id` whenever you have it; it's unambiguous. Names can be duplicated — Plumb handles that by returning a list of matches for the agent to disambiguate.

Read tools that need design data auto-pick between the **plugin path** (instant, no rate limits, requires Figma open) and the **REST path** (headless, rate-limited, requires `FIGMA_TOKEN`). With the plugin paired, omit `fileKey`. For REST, pass `fileKey` + `id`.

The plugin-path tools — `plumb_outline`, `plumb_selection`, `plumb_assets`, `plumb_screenshot`, `plumb_search`, `plumb_components` — require the plugin paired and won't fall back to REST. The other read tools (`plumb_node`, `plumb_query`, `plumb_describe`, `plumb_tokens`, `plumb_verify`, `plumb_fit`) work on both paths.

**Every write tool builds through the plugin path** — `plumb_studio`, `plumb_brand`, and `plumb_design` all require the Plumb plugin paired to write to Figma (`plumb_design` can `dryRun` to compile + validate without it). `plumb_review` is read-only — it grades the emitted result — and `plumb_source` needs no Figma connection at all.
