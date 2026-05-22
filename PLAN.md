# Plumb

**A local, free, token-frugal Figma → code bridge for AI coding agents.**

> Plumb reads your Figma file *locally* — through a companion plugin, with no rate
> limits and no metered billing — and hands your coding agent a compact, accurate
> design spec instead of a 350,000-token JSON dump. Pixel-perfect screens, a
> fraction of the tokens, on any Figma plan including free.

Status: **planning (plan v2 — agent-optimized)** · License (intended): **MIT** · Author: Tathagat Maitray

---

## 1. Why Plumb exists

Building UI from Figma with an AI agent today means choosing between two bad options.

### Figma's official Dev Mode MCP server
- **Plan-gated into uselessness for most people.** Starter plans and View/Collab seats get **6 tool calls per month** — one screen build burns that before lunch. Even paid Dev seats are capped at 200/day and 10–20/min, and 429s land mid-task.
- **Token explosion.** `get_design_context` on a real screen has been observed returning **351,378 tokens** against a client hard cap of **25,000**. Figma's own "known issues" page just tells you to crank `MAX_MCP_OUTPUT_TOKENS` or fetch one node at a time.
- **Inaccuracy.** Forum reports of output "85–90% wrong" on complex designs — wrong colours, wrong font sizes, styles on the wrong nodes. When structured extraction fails it silently falls back to a screenshot and the model *guesses*.
- **Needs the desktop app open** with the right selection (desktop mode). Not headless, not CI-friendly.
- **Metered.** It is a billed product.

### The popular community alternative — Framelink `figma-developer-mcp` (~14.8k★)
- REST-API based, so it dodges the MCP plan gate — a genuine improvement — **but** it still inherits REST rate limits (see §3) and **still chokes on large files** (its own issue tracker: the agent re-calls the tool repeatedly because the design won't fit context).
- **Design tokens / variables are a years-open weak spot.**
- Shipped a real **RCE — CVE-2025-53967** (command injection), and a telemetry path that leaked file keys.

### The gap
Nobody has built a Figma extractor that is **all four** of: free on any plan, local/offline-first, genuinely token-frugal, and accurate about auto-layout + design tokens. That is the entire lane Plumb occupies.

---

## 2. The name

**Plumb** — chosen for a triple meaning that all land on this exact project:

1. **The plumb line** is the original pixel-perfect tool — the reference for true vertical. This project is *for* pixel-perfect UI work.
2. **To plumb** something is to examine it deeply — Plumb extracts the full depth of a design, on demand.
3. **Plumbing** is the local pipe — Plumb is the quiet local conduit between Figma and your editor.

Short, lowercase, types well as a command (`npx plumb-mcp`), developer-credible, not cutesy.

> npm note: the bare name `plumb` may be taken — ship the CLI as **`plumb-mcp`** (or a scope). The product is still "Plumb".

**Alternates considered** (kept on the table in case you want to override): *Loupe* (the precision magnifier designers use — but `loupe` is a well-known npm package), *Caliper* (precision measuring — collides with Hyperledger Caliper), *Figlens*.

---

## 3. The core constraints (research findings that shape the design)

These are confirmed from primary docs. They are *why* the architecture is what it is.

| Data source | Free? | Rate limit | Variables? | Needs Figma open? | Headless/CI? |
|---|---|---|---|---|---|
| **Figma Plugin API** | ✅ any plan | **none** (reads in-memory doc) | ✅ **yes, even free** | yes | no |
| **Figma REST API** | ✅ any plan | ⚠️ Tier-1 = **very low** for files in a *Starter* workspace; 15–20/min on paid | ❌ Variables REST API is **Enterprise-only** | no | yes |
| **Local `.fig` file** | ✅ | none (offline) | ✅ (in the file) | no | yes |

> ⚠️ **Verify before it ships in marketing copy:** the Starter-tier REST figure has been
> reported as low as *~6 requests per month* (cost-based, keyed to the file's workspace).
> This number is load-bearing for the whole pitch — re-confirm the current value against
> Figma's live rate-limit docs before quoting it publicly. The *conclusion* below holds
> regardless of the exact figure: REST cannot be the primary path for free users.

Three consequences:

1. **The REST API cannot be the primary path** — the Starter-workspace cap (keyed to the file's workspace, not the caller) would make Plumb feel broken for free users. It is a **secondary, headless** path.
2. **The Plugin API is the primary path.** It has *no rate limits at all* (it reads the document already in memory), works on every plan, and — critically — **can read Variables on free accounts**, which the REST API cannot. The cost is that Figma must be open with the file. For the target workflow (a developer building a screen from a Figma frame) the file is open anyway.
3. **Design tokens come from the plugin, not REST.** This is the single most important architectural decision and Plumb's sharpest advantage over every REST-only competitor.

---

## 4. Architecture

```
        Figma (desktop OR browser — any plan)
        ┌──────────────────────────────────────┐
        │  Plumb Plugin  (small always-open    │
        │  panel — Figma kills a plugin when    │
        │  its UI closes, so it is minimized,   │
        │  never closed)                        │
        │  • reads the live document via the   │
        │    Plugin API — geometry, text,      │
        │    auto-layout, components, VARIABLES│
        │  • no rate limits (in-memory read)   │
        │  • optional watch: figma.on(         │
        │    'documentchange') → live updates  │
        └───────────────────┬──────────────────┘
                            │  localhost WebSocket  (127.0.0.1:<port>)
                            │  Origin-checked + pairing token
                            ▼
   ┌───────────────────────────────────────────────────────────┐
   │  Plumb MCP Server   — local process, `npx plumb-mcp`      │
   │                                                           │
   │   ┌──────────┐   ┌────────────┐   ┌──────────────────┐    │
   │   │ Ingest   │──▶│ Normalizer │──▶│ Spec store        │    │
   │   │ plugin / │   │ raw nodes  │   │ • PDS tree        │    │
   │   │ REST /   │   │ → PDS +    │   │ • token table     │    │
   │   │ .fig     │   │ token dedup│   │ • cached by       │    │
   │   └──────────┘   └────────────┘   │   file version    │    │
   │                                   └──────────────────┘    │
   │   MCP tools  (plumb_status, plumb_outline, plumb_node,    │
   │               plumb_tokens, plumb_verify, …)               │
   └───────────────────────────┬───────────────────────────────┘
                                │  stdio  (MCP / JSON-RPC)
                                ▼
              Coding agent — Claude Code · Cursor · VS Code
              (builds the UI, then sends rendered layout
               back through plumb_verify — see §6.5 / §8)
```

### Components

- **Plumb Plugin** — a small Figma plugin. Main thread reads the document and variables; UI iframe opens a WebSocket to the local server and streams a compact payload. Manifest declares `networkAccess.allowedDomains` with the narrowest localhost endpoints (`127.0.0.1`/`localhost`, fixed port range) for the **published** plugin, plus `devAllowedDomains` for sideloaded development (§15). Optional **watch mode** re-streams (debounced) on `documentchange`. **Lifecycle note:** a Figma plugin only runs while its UI is open — closing the panel terminates the plugin. Plumb's panel is therefore designed to be *minimized*, not closed; the UI makes that explicit.
- **Ingest layer** — three pluggable sources behind one interface: `plugin` (primary), `rest` (headless, token-based), `fig` (offline file parse, stretch goal). Whatever the source, it produces the same raw node model.
- **Normalizer** — the heart of Plumb. Turns raw Figma nodes into the **Plumb Design Spec** (§5): resolves auto-layout to flexbox per the explicit rules in **Appendix A**, dedups styles into a token table, prunes noise, maps component instances to a single component definition + overrides.
- **Spec store / cache** — the normalized spec on disk, keyed by `fileKey@version`. A cheap version check (REST `?depth=1`, or the plugin's own change events) decides whether to re-ingest. Re-asking about an unchanged screen costs **zero** upstream calls.
- **MCP server** — stdio transport, exposes the tools in §8, shipped to run via `npx` with zero install.

### Transports
- **Plugin ↔ server:** WebSocket on localhost (enables live watch; plugin is the client because the Figma sandbox can't host a server). The server **validates the `Origin` header** against the Figma plugin iframe origin *and* requires a short-lived pairing token — a localhost WebSocket is otherwise reachable by any web page the user visits (§14).
- **Server ↔ agent:** **stdio** MCP — the right choice for a local dev tool; no ports/CORS/TLS, works in every MCP client. (Streamable-HTTP transport is left as a later option for a shared/team deployment.)

---

## 5. The Plumb Design Spec (PDS) — the soul of the project

The official MCP fails because it ships *raw Figma JSON* (or invented code). PDS is a **normalized, deduplicated, CSS-shaped** representation built for an LLM to read cheaply and implement correctly.

Principles:
- **Dedup by reference.** A design file repeats the same fill/typography hundreds of times. PDS extracts them once into a token table; nodes reference `$accent`, not `{"r":0.54,"g":0.42,"b":1}`.
- **Auto-layout is pre-resolved to flexbox.** `layoutMode`/`layoutWrap`/`itemSpacing`/padding/align become `flow`, `wrap`, `gap`, `pad`, `align` — the agent writes `flex` directly, no guessing. The exact mapping is fixed in **Appendix A** and is the single source of truth shared by the normalizer and the agent.
- **Children are IDs, not inlined.** A node lists child handles; the agent drills in only where it needs to (progressive disclosure).
- **Defaults and noise are dropped.** Invisible nodes, empty arrays, identity transforms, `absoluteRenderBounds`, export settings — gone unless asked for.
- **Component instances collapse.** Figma already types instances as `INSTANCE` with a `mainComponent` pointer, so collapse is exact, not heuristic: 12 instances become one component definition + 12 lightweight references carrying only their overrides.
- **Every node carries a stable handle.** Each node has `id` (Figma's raw id) *and* `el` — a short, stable, human-readable handle (e.g. `dialog-footer-cancel`). `el` is what the agent puts in code (`data-plumb-id`) so `plumb_verify` can join render→design exactly (§6.5).
- **Deterministic output.** Same `fileKey@version` + same query ⇒ byte-identical response (stable key order, sorted token tables, no timestamps in payload). Free caching, meaningful diffs.

### Example — the export-employees dialog, as PDS

```jsonc
// tokens (extracted once, referenced everywhere)
{
  "color": { "$bg":"#f7f7fb", "$accent":"#8b6cff", "$ink":"#121212", "$card":"#fff" },
  "text":  { "$h2":"700 20px/1.2", "$body":"500 12px/1.4" },
  "radius":{ "$r-card":21, "$r-chip":10 }
}
```
```jsonc
// node at depth 1
{
  "id": "131:6950",
  "el": "export-employees-dialog",        // stable handle → data-plumb-id in code
  "name": "Export employees · dialog",
  "type": "frame",
  "box": { "w": 528, "h": 578 },
  "layout": { "flow": "col", "gap": 0, "pad": [0,0,0,0] },
  "fill": "$bg", "stroke": "$accent", "radius": "$r-card",
  "children": ["header", "employees-card", "format", "fields", "options", "footer"],
  "notes": ["auto-layout VERTICAL", "fixed width"]   // opt-in — present only when notes:true
}
```

A whole screen at `depth: 2` lands in **single-digit thousands of tokens** — versus the 350k the official server has produced. That is the headline number.

### Honesty about fidelity
PDS is the *spec*. `plumb_verify` (§8) now closes the loop **structurally and exactly** for everything the agent tags — geometry and resolved styles are compared numerically, not eyeballed. What remains genuinely hard is sub-pixel rendering: font hinting, fractional line-box rounding, and flex-wrap thresholds can still tip a layout. Plumb's job is to make the **first** build correct enough that verification finds *nothing structural*, and to leave only true rendering nuance to the optional screenshot pass. Verification is sharpened, not abolished.

---

## 6. The agent contract — Plumb as an AI agent's tool

Plumb is consumed by an LLM, not a human, so its *interface* is part of the product. These six guarantees let **any** coding agent — Claude Code, Cursor, Copilot, Windsurf, Cline, a bare MCP client — use Plumb correctly with zero prior knowledge and zero external docs.

### 6.1 A canonical call sequence (the playbook)
Tool descriptions encode the next step so the agent self-routes without being told:

```
plumb_status   → discover connection, file/version, key legend, token budget
   ↓
plumb_outline  → shallow map of the file (pages → frames → top nodes)
   ↓
plumb_node     → drill the target subtree at a depth that fits the budget
   ↓
plumb_tokens   → resolve the design system (colours, type, spacing, modes)
   ↓
( agent writes the UI, tagging elements with data-plumb-id )
   ↓
plumb_verify   → structural delta list → agent fixes in one pass
```

Every tool response carries a `next` field naming the tool the agent should usually call next, with the exact arguments to use. The agent is *guided*, not left to guess.

### 6.2 Deterministic, stable output
Same file version + same query ⇒ byte-identical bytes. Stable key ordering, stable `id`/`el` scheme, sorted token tables, no timestamps or run-ids inside payloads. Caching is free; diffing two responses is meaningful; re-runs never surprise the agent.

### 6.3 Self-describing responses (no external docs needed)
Terse keys (`box`, `pad`, `flow`, `$accent`) save tokens but cost comprehension — so the vocabulary is delivered *in-band*: `plumb_status` returns the full **key legend** once per session (a few hundred tokens, paid once), and every tool also declares a Zod **`inputSchema` and `outputSchema`** plus `readOnlyHint: true` and `idempotentHint: true`. Agents that support typed/structured tool results get them; agents that don't still get the legend from `plumb_status`. The model never has to know anything about Plumb in advance.

### 6.4 Fit-to-budget, not truncate-after
Every detail tool accepts an optional `maxTokens`. Plumb chooses the `depth`/detail that *fits before serializing*, and returns `depthUsed` plus a `more` cursor (an `{id, depth}` the agent can call to go deeper). Post-hoc truncation still exists as a last-resort fallback (`truncated: true` + a narrowing `hint`) — but the normal path simply never overflows the 25k ceiling.

### 6.5 Stable ids the agent carries into code
Every PDS node exposes `el` — a short, stable, collision-free, human-readable handle. Tool descriptions instruct the agent: **tag every rendered element you build from a node with `data-plumb-id="<el>"`.** That one convention turns `plumb_verify` from a fuzzy screenshot comparison into an exact structural join (render element ↔ design node) — no computer vision, no correspondence guessing. The `el` scheme is defined once (path-based, deduped on collision) so it survives file edits where possible.

### 6.6 Errors are instructions, not codes
Every failure returns `{ error, nextAction }` where `nextAction` is a literal, executable step — *"Figma isn't connected. Open the file in Figma; the Plumb plugin panel will auto-link (green dot). Then retry plumb_outline."* No raw MCP/JSON-RPC error code ever reaches the model. The agent can always make progress.

---

## 7. Token-efficiency strategy (the feature, not an afterthought)

Every competitor either overflows context or trims "just enough" to still overflow on a real screen. Plumb treats the **~25,000-token per-response ceiling** as a hard design budget.

- **Progressive disclosure.** `plumb_outline` returns a shallow map (pages → frames, ids + names + sizes only). `plumb_node` drills into one subtree at a chosen `depth`. The agent fetches detail *only where it builds*.
- **Token-table dedup.** Colours, type styles, radii, shadows, spacing → one table, referenced by short id. Biggest single win on real files.
- **Component collapse.** Repeated `INSTANCE` nodes → one definition + override deltas.
- **Aggressive default-pruning.** Drop anything at its default value or invisible.
- **Compact encoding.** Terse keys, arrays over verbose objects (`pad:[20,20,20,20]`), no pretty-print whitespace.
- **Opt-in `notes`.** Human-readable hints (`"auto-layout VERTICAL"`, `"fixed width"`) duplicate the structured fields and exist only for a human skimming the spec — they are **off by default** and returned only when the agent passes `notes: true`. Every node saves a few tokens; a screen saves hundreds.
- **Delta responses under watch mode.** After a `documentchange`, re-querying a node returns only the changed sub-tree plus a `changed` id list — not the whole subtree again. Iterative design edits (the common case) then cost almost nothing.
- **Fit-to-budget (§6.4).** `maxTokens` in, best-fitting depth out — overflow is prevented, not patched.
- **A budget meter.** Every response carries an estimated token cost; `plumb_outline` tells the agent up front *"this frame is ~3k tokens at depth 2, ~11k at depth 4"* so it can plan instead of overflowing.
- **Truncate gracefully.** If a response would still blow the budget, Plumb truncates, sets a `truncated` flag, and returns a `hint` on how to narrow the query — never a hard failure.
- **Assets by reference.** Icons/images are exported to a local folder and returned as file paths, never inlined as base64.

**Target:** a typical app screen, structurally complete at the depth an agent needs to build it, in **< 10k tokens** — a 30–50× reduction versus the official server's worst case.

---

## 8. MCP tool surface

All read-only — `readOnlyHint: true`, `idempotentHint: true`. Every tool declares a Zod `inputSchema` and `outputSchema` (sketched in **Appendix B**). Names are prefixed `plumb_`.

| Tool | Purpose |
|---|---|
| `plumb_status` | What's connected (plugin live? REST configured?), which file/version is loaded, the **key legend** (§6.3), and the token-budget estimate. The agent's mandatory first call. |
| `plumb_outline` | Shallow tree — pages → frames → top-level nodes (id, el, name, type, size) + per-frame token-cost estimate at several depths. Cheap map of the file. |
| `plumb_node` | The workhorse. PDS for a node `id` at a given `depth` (default 2), honouring `maxTokens`. Returns `depthUsed` + a `more` cursor. Progressive drill-down. |
| `plumb_tokens` | The design-token / variable table — colours, type, spacing, radii, shadows, with modes (light/dark), alias chains, scopes, and **untokenized-value warnings**. |
| `plumb_components` | Component definitions + a list of where instances are used and their overrides. |
| `plumb_search` | Find nodes by name/type — "where is the primary button". Returns `{id, el, path}` hits. |
| `plumb_assets` | Export icons/images under a node to a local folder (SVG preferred); return paths. |
| `plumb_screenshot` | Render a Figma node to PNG at a chosen scale; return a file path. Reference image for the agent and for the optional pixel-overlay pass. |
| `plumb_verify` | **The closer — redesigned (see below).** Given the agent's *rendered layout* (not a screenshot) + a Figma node id, return *structured deltas*. |

### `plumb_verify`, redesigned — structural, exact, headless

The original sketch leaned on a pixel diff (`pixelmatch`). A pixel diff produces a *heatmap of differing pixels* — it cannot say "Cancel button 4px too tall" or "fill #8b6cff vs #8a6dff", because those are **element-level** facts. So `plumb_verify` no longer compares images. Instead:

1. While building, the agent tags each element with `data-plumb-id="<el>"` (§6.5).
2. After building, the agent collects the **rendered layout** — for every tagged element: its `getBoundingClientRect()` box plus a fixed set of `getComputedStyle()` properties (background, color, font, line-height, letter-spacing, padding, gap, border, border-radius, box-shadow, opacity). This is a small JSON, obtainable headlessly via Playwright/Puppeteer DOM queries — **no screenshot required**.
3. The agent calls `plumb_verify({ nodeId, viewport, rendered: [{ el, box, styles }, …] })`.
4. Plumb joins each rendered element to its PDS node by `el`, compares geometry and resolved styles within **explicit tolerances**, and returns:

```jsonc
{
  "deltas": [
    { "el":"dialog-footer-cancel", "kind":"size.h",  "expected":36,        "actual":40,        "severity":"warn" },
    { "el":"field-chip-row",       "kind":"gap",      "expected":8,         "actual":10,        "severity":"warn" },
    { "el":"dialog-header-title",  "kind":"fill",     "expected":"#8b6cff", "actual":"#8a6dff", "severity":"error" },
    { "el":"options-toggle",       "kind":"missing",  "expected":"present", "actual":"absent",  "severity":"error" }
  ],
  "matched": 41, "checked": 43, "ok": false,
  "next": "Fix the 4 deltas above, then call plumb_verify again."
}
```

Deterministic, exact, headless, no computer vision. An **optional** pixel-overlay (`plumb_screenshot` of the Figma node vs. the agent's own image, `pixelmatch`-style) remains available as a *secondary* signal for sub-pixel rendering nuance — but it is no longer the mechanism. This collapses the build→screenshot→eyeball→fix cycle from ~3 rounds to 1.

CLI: `plumb init` detects Claude Code / Cursor / VS Code / Windsurf and writes the correct MCP config (`mcpServers` vs `servers`, `env` block for any token), and walks the user through one-click plugin install.

---

## 9. What's genuinely new — ideas that make developers (and agents) love it

Beyond "REST but leaner," these are the differentiators:

1. **`plumb_verify` — the design closes its own loop, exactly.** No other tool does this. The agent builds the screen, hands Plumb its *rendered layout*, and Plumb returns *actionable, element-level deltas* by structural join — not a fuzzy image diff. Collapses three fix rounds to one. (This is the exact pain that motivated Plumb.)
2. **Variables on free plans.** Because tokens come from the plugin, Plumb resolves Figma Variables — modes, aliases, scopes — on a *free* account. The REST-only competitors structurally cannot.
3. **Untokenized-value detection.** Plumb flags hard-coded hex/spacing that *should* be a variable, so the generated code uses the design system instead of magic numbers — and the designer learns where the file is sloppy.
4. **Faithful auto-layout.** Auto-layout → flexbox is resolved server-side per **Appendix A**; absolute-positioned nodes are explicitly flagged. The agent never reverse-engineers layout from coordinates.
5. **Component-aware extraction.** `INSTANCE` nodes collapse to one definition + override deltas — exact, not heuristic. Huge token saving *and* it nudges the agent toward a component, not 12 copies.
6. **Watch mode.** With the plugin panel open, debounced `documentchange` events keep the spec live — edit in Figma, the agent sees it without re-fetching.
7. **Offline `.fig` mode (stretch).** Parse a saved `.fig` (Kiwi-encoded) directly — zero network, zero account, zero rate limit. The ultimate "local."
8. **Framework-aware output.** PDS can be emitted Tailwind-annotated, plain-CSS, or raw — the agent asks for what it wants.
9. **Zero telemetry, localhost-only, Origin-checked, sanitized inputs.** A direct, deliberate answer to the CVE and the file-key-leak that hit the incumbent. Security is a feature here.
10. **Speed as a feeling.** The plugin reads memory; the server caches by version. After first load, every query is effectively instant — no spinner, no Figma round-trip.
11. **Built to be driven by an LLM (§6).** Self-describing, deterministic, budget-aware, instruction-shaped errors, a baked-in call playbook. Plumb is the rare MCP server whose *interface* was designed for the consumer that actually calls it.

---

## 10. Frictionless by design — the daily driver

Plumb only succeeds if it nearly **disappears**. The honest bar isn't "zero friction" — the plugin must be installed and a small panel kept open in Figma. The bar is that after a one-time setup, that friction is *paid once* and never thought about again, the way you never re-think your formatter. The friction Plumb keeps (a plugin, a panel) is the friction that *buys* no rate limits and free-plan Variables — a deliberate trade, not an oversight.

### Setup — once, two steps, under five minutes
1. **Install the Plumb plugin** from the Figma Community — one click.
2. **`npx plumb-mcp init`** — auto-detects your editor (Claude Code, Cursor, VS Code, Windsurf), writes the correct MCP config for it, prints a 60-second "how to use me." Done.

No personal access token. No port numbers. No JSON hand-editing.

### No token for the everyday path
Every competitor's first instruction is *"go to Figma settings, generate a personal access token, paste it."* Plumb's **plugin path needs none** — the plugin reads the document you already have open. A token is only ever needed for the optional headless/CI REST path. Deleting that one step removes the most common reason people abandon setup.

### Zero-config pairing
When Figma (with the plugin) and the MCP server are both running, they **find each other** on localhost automatically — fixed default port, graceful fallback scan — and complete a short-lived, Origin-checked pairing handshake invisibly. The user copies nothing. With several files open, the agent works off the active selection or the file it was pointed at.

### It rides habits you already have
A developer building UI already has **Figma open and their editor open**. Plumb adds little to that routine: keep the Plumb panel open (minimized is fine — but note that *closing* it stops the plugin), select a frame or paste its link, tell the agent to build it. Watch mode keeps the spec live as the designer edits.

### The agent self-serves
Tool descriptions are written so the agent reaches for Plumb **on its own** the moment a Figma URL or a "build this screen" appears — the user never types "use plumb." `plumb_status` lets the agent discover the connection, the loaded file, the key legend, and the token budget without being told (§6).

### Honest, plain-English failures
The plugin UI is a single small panel — a connection dot and the current selection. When something is off, Plumb speaks in human words (*"Figma isn't connected — open your file; the Plumb plugin panel will auto-link"*), and `plumb doctor` diagnoses client config, port conflicts, and plugin version. Never a raw MCP error code (§6.6).

### A day with Plumb
> **9:00** — open Figma and your editor. The plugin panel auto-links (green dot); the MCP server boots with your editor. You did nothing but leave the panel open.
> **10:30** — "build the settings screen from this frame," paste the link. The agent calls `plumb_status → plumb_outline → plumb_node → plumb_tokens` and builds it, tagging elements as it goes.
> **10:45** — "verify it." The agent collects its rendered layout; `plumb_verify` returns a delta list; the agent fixes them in one pass.
> **11:10** — the designer nudges a colour in Figma. Watch mode refreshes the spec; your next question already has the new value.
>
> You never opened a settings panel, never pasted a token, never hit a rate limit, never overflowed context.

### Cross-tool, one setup
The same install works across Claude Code, Cursor, VS Code, and Windsurf. Fast startup, low memory, auto-update, zero telemetry. It stays out of the way because staying out of the way *is* the feature.

---

## 11. Tech stack

- **Language:** TypeScript throughout (server + plugin).
- **MCP:** `@modelcontextprotocol/sdk` (`^1.x`), `McpServer` + `registerTool` with explicit `inputSchema`/`outputSchema`, **stdio** transport.
- **Validation:** `zod` for every tool input *and* output.
- **HTTP/WebSocket:** `ws` for the plugin bridge (server validates `Origin` + pairing token); native `fetch`/`undici` for the REST path.
- **Verify:** structural diff of the agent's rendered layout (`getBoundingClientRect` + `getComputedStyle`) against PDS within explicit tolerances — **no computer vision**. `sharp` is used only by `plumb_screenshot` for raster export; an optional `pixelmatch` overlay is a secondary, non-load-bearing signal.
- **Plugin:** standard Figma plugin (`manifest.json`, `code.ts` main thread, `ui.html` iframe), bundled with `esbuild`.
- **Packaging:** ESM, `bin` entry with shebang, `npx`-runnable, `engines.node >= 20`. Build with `tsup`.
- **Cache:** on-disk JSON under `~/.cache/plumb/`, keyed `fileKey@version`, small in-memory LRU on top.
- **Quality:** the official `figma/rest-api-spec` OpenAPI types codegen'd for the REST path; unit tests on the normalizer driven by a **fixture corpus of recorded Figma files** (§14) — not a single golden file — covering auto-layout wrap, mixed sizing, nested components, and per-character text overrides; the export-employees dialog kept as one named golden case among many.

---

## 12. Roadmap

> Honest sizing: **M0 is a weekend. M1 is the real product and several weeks of work** — the normalizer (Appendix A) is most of that. M2–M4 are each substantial; treat M0+M1 as the commitment and the rest as "decide once there are users."

### Milestone 0 — Proof (a weekend)
- Stdio MCP server scaffold, `npx`-runnable, one tool: `plumb_node` via the **REST** path (REST is used here only because it needs no plugin — a handful of calls against one known file is well within any tier; this proves the *normalizer*, not the architecture).
- Minimal normalizer: node tree → PDS with token-table dedup and `el` handles.
- Prove on the real export-employees frame (`131:6950`) that PDS is < 10k tokens and structurally complete.

### Milestone 1 — The plugin path (MVP — the bulk of the engineering)
- Plumb plugin: read document + variables, stream over an Origin-checked localhost WebSocket.
- Ingest layer with `plugin` + `rest` sources behind one interface.
- Tools: `plumb_status` (with key legend + budget), `plumb_outline`, `plumb_node` (fit-to-budget), `plumb_tokens`.
- Version-keyed disk cache; deterministic output.
- `plumb init` config generator for Claude Code / Cursor / VS Code / Windsurf.
- Zero-config, Origin-checked plugin↔server pairing — no token, no ports, no copy-paste.
- **Ship publicly.** README, MIT licence, GitHub.
- **Plugin distribution (§15).** Sideload (import-from-manifest) works on day one; the Figma Community listing is submitted now and goes live whenever review clears — don't gate the M1 release on it.

### Milestone 2 — Accuracy & assets
- `plumb_components` (component collapse + instance overrides).
- `plumb_assets`, `plumb_screenshot`, `plumb_search`.
- Untokenized-value detection; auto-layout fidelity hardening against the fixture corpus.
- Token-budget meter + graceful truncation.

### Milestone 3 — The closer
- `plumb_verify` — the structural render-layout diff of §8 (the `data-plumb-id` tagging convention, the `el` scheme, the tolerance table).
- Watch mode (debounced live `documentchange` streaming).
- Framework-aware PDS output (Tailwind preset).

### Milestone 4 — Offline & polish
- `.fig` (Kiwi) offline parser as a third ingest source.
- Streamable-HTTP transport option for shared/team use.
- Docs site, examples, a short demo video.

---

## 13. Differentiation at a glance

| | Figma official MCP | Framelink (REST) | **Plumb** |
|---|---|---|---|
| Works on free Figma plans | ✗ (6 calls/mo) | ⚠️ REST limits | ✅ plugin path, no limit |
| Rate-limited | ✅ heavily | ✅ REST tiers | ✅ **none** on plugin path |
| Token-frugal output | ✗ (350k seen) | ⚠️ better, still overflows | ✅ designed to a 25k budget, fit-to-budget |
| Design Variables | ✅ (paid) | ✗ weak | ✅ **free**, via plugin |
| Auto-layout fidelity | ⚠️ | ⚠️ | ✅ pre-resolved to flex (Appendix A) |
| Verifies the result | ✗ | ✗ | ✅ `plumb_verify` — exact structural deltas |
| Designed for an LLM consumer | ⚠️ | ⚠️ | ✅ self-describing, deterministic, playbook |
| Headless / CI | ✗ desktop app | ✅ | ✅ REST path |
| Offline | ✗ | ✗ | ✅ `.fig` (stretch) |
| Metered / billed | ✅ | ✗ | ✗ free, MIT |
| Telemetry / known CVE | — | ⚠️ history | ✅ none, by design |

---

## 14. Risks & open questions

- **Plugin lifecycle.** A Figma plugin runs *only while its UI is open* — closing the panel terminates the plugin and kills watch mode. Mitigation: a deliberately small, always-open panel; the UI says "minimize, don't close"; `plumb_status` reports the plugin as disconnected the instant the panel closes so the agent fails loud, not silent.
- **Plugin distribution.** See §15 for the full path — sideload works day one, the Community listing is submitted at M1 and goes live whenever review clears.
- **Plugin ↔ server pairing.** A localhost WebSocket is reachable cross-origin by any web page the user visits. The server **must** validate the `Origin` header against the Figma plugin iframe origin *and* require a short-lived pairing token. Security-critical — design and review this before M1 ships.
- **REST Starter limit figure.** The "~6/month" number must be re-confirmed against current Figma docs before it appears in any README or marketing copy (§3).
- **`.fig` parsing** depends on the unofficial Kiwi schema — treat as research, not a commitment; the plugin path already covers offline-ish use.
- **REST `depth` quirks** — one report of `depth` being inconsistently honoured on the file endpoint; verify against real files.
- **Normalizer is the hard part.** Auto-layout edge cases (wrap, mixed sizing, nested constraints), text with per-character overrides, weird component nesting. Build a **fixture corpus of varied real files early** — one golden file will not catch these. This is where most engineering time goes; budget for it.
- **`el` handle stability.** Generating short, human-readable, collision-free handles that *survive file edits* (renames, reorders) is its own small design problem. Define the scheme (path-based, deduped, with a fallback to raw id) and test it against edited fixtures.
- **`plumb_verify` depends on the agent collecting rendered layout.** Plumb does not own a browser — the agent must query the DOM (Playwright/Puppeteer or an equivalent). Document this dependency clearly in the tool description and degrade gracefully (`nextAction`) when layout isn't supplied.
- **MCP SDK churn** — the SDK moves fast; pin versions, watch `registerTool` schema shape.
- **Scope discipline.** The temptation to also *write* to Figma is real — resist it for v1. Plumb is an *extractor*; staying read-only keeps it simple, safe, and fast.

### Design tasks to resolve before Milestone 1

Two items above are not "risks" to monitor — they are **unsolved design decisions** that block M1. Resolve them and write them down first.

**1. Plugin ↔ server pairing.** Constraint: the goal is *zero copy-paste*, but a `127.0.0.1` WebSocket is reachable by any web page — and Figma plugin UIs run sandboxed and send `Origin: null`, so the `Origin` header alone is **not** a sufficient signal. Candidate approaches to threat-model and choose from:
   - **Trust-on-first-use window** — the server accepts the first plugin connection within N seconds of startup, then locks; a malicious page would have to win a race.
   - **One-time confirm in the plugin panel** — a single "Pair with Plumb" click, no code to copy; mild friction, strong signal.
   - **Token via the CLI side** — `plumb init` / the running server mint a token the plugin learns through a deep link or a one-time pasted value.
   - Combine the chosen mechanism with: bind to loopback only, a per-message nonce, and reject new connections once paired.
   Pick one, write the threat model, *before* any WebSocket code ships.

**2. `el` handle scheme.** Good news — Figma node `id`s are *already stable across edits*, so `el` only needs to be a stable, readable **alias** of a stable id, not a stability mechanism itself. Recommended scheme: `el = slug(name-path)`, minted on first sight, collisions broken with a short suffix, and the `figmaId → el` mapping **persisted in the version cache** so a node keeps its `el` even when siblings are renamed or reordered. New nodes mint fresh handles. Specify it and test against *edited* fixture files before `plumb_verify` depends on it.

---

## 15. Plugin distribution & publishing

Plumb ships the plugin through **two channels, in this order.**

### Day one — sideload (development mode)
Anyone can run the plugin before it is published: in the **Figma desktop app**, *Plugins → Development → Import plugin from manifest*, pointed at `manifest.json`. No review, instant. `plumb init` drops the plugin folder locally and prints these steps.
**Caveat:** importing a local plugin is **desktop-app only** — the browser runs *published* plugins only. So the sideload path is desktop-only; browser support arrives with the Community listing.

### The real channel — Figma Community listing
A published plugin installs in one click and runs in **both desktop and browser**.
- **Publish from the Figma desktop app**: select the plugin → *Publish*. It goes out under a Figma profile — use a dedicated **creator/org profile** ("Plumb"), not a personal account.
- **Submission assets**: name, tagline, description, an **icon (128×128)**, **cover art**, a category/tags, and a support contact. *(Confirm exact image dimensions against Figma's current Community publishing page — they change.)*
- **Review**: Figma reviews every new plugin and every significant update — budget **a few business days to ~two weeks**. Review checks policy compliance, that the plugin actually works, and — most relevant here — **`networkAccess`**. Plumb's localhost-only, zero-telemetry posture is a *clean* review story: declare the narrowest possible `allowedDomains` and review is straightforward.
- **Visibility**: list it **unlisted** (link-only) first to dogfood, then flip to **public** for launch.
- **Updates**: bump the version and re-publish; installed users auto-update. Large changes get re-reviewed.

### Manifest network access — correctness note
`devAllowedDomains` grants domains **only during development**. The **published** manifest must declare its localhost endpoints in **`networkAccess.allowedDomains`**, kept as narrow as possible (`127.0.0.1` + `localhost`, fixed port range) — both for security and for a frictionless review.

> Roadmap impact: M1's "ship publicly" splits in two — **sideload works the day M1 lands**; the **Community listing is submitted at M1 and goes live asynchronously** when review clears. Never block the M1 release on Figma's review queue.

---

## 16. Definition of success

- A developer on a **free** Figma plan extracts a full screen and builds it pixel-perfect, with no rate-limit wall and no token overflow.
- A screen's spec fits comfortably under the 25k ceiling — typically **< 10k tokens**.
- `plumb_verify` returns exact, element-level deltas and cuts a build from three screenshot-fix rounds to one.
- Any MCP-capable agent uses Plumb correctly **without external docs** — discovering the playbook, key legend, and budget from `plumb_status` alone.
- Setup is two steps, **no token**, under five minutes — and after that the plugin panel is the only thing to remember.
- It is the tool people *recommend* when someone asks "how do I get Figma into my agent without the rate limits."

---

## Appendix A — Figma → PDS/CSS mapping (the normalizer's single source of truth)

The normalizer and any consuming agent share *this* table. If a Figma property is not listed, it is dropped unless explicitly requested.

### Layout (auto-layout frames)
| Figma | PDS | CSS |
|---|---|---|
| `layoutMode: HORIZONTAL` / `VERTICAL` | `layout.flow: "row"` / `"col"` | `display:flex; flex-direction:row\|column` |
| `layoutWrap: WRAP` | `layout.wrap: true` | `flex-wrap:wrap` |
| `itemSpacing` | `layout.gap` | `gap` |
| `counterAxisSpacing` (wrap) | `layout.gapCross` | `row-gap`/`column-gap` |
| `paddingTop/Right/Bottom/Left` | `layout.pad: [t,r,b,l]` | `padding` |
| `primaryAxisAlignItems: MIN\|CENTER\|MAX\|SPACE_BETWEEN` | `layout.justify` | `justify-content: flex-start\|center\|flex-end\|space-between` |
| `counterAxisAlignItems: MIN\|CENTER\|MAX\|BASELINE` | `layout.align` | `align-items: flex-start\|center\|flex-end\|baseline` |
| `layoutSizingHorizontal/Vertical: FIXED` | `box.w`/`box.h` literal | fixed `width`/`height` |
| `layoutSizingHorizontal/Vertical: HUG` | `size: "hug"` | `width:fit-content` (or default) |
| `layoutSizingHorizontal/Vertical: FILL` | `size: "fill"` | `flex:1` / `align-self:stretch` |
| `itemReverseZIndex` | `layout.reverseZ: true` | (note for stacking) |
| non-auto-layout child + `constraints` | `pos: "absolute"` + `inset` | `position:absolute` + offsets |

### Box & paint
| Figma | PDS | CSS |
|---|---|---|
| `cornerRadius` / per-corner radii | `radius` (scalar or `[tl,tr,br,bl]`) | `border-radius` |
| `fills[SOLID]` | `fill: "$token"` | `background` / `color` |
| `fills[GRADIENT_*]` | `fill: {gradient…}` | `background: linear/radial-gradient(…)` |
| `fills[IMAGE]` | `fill: {image: assetRef}` | `background-image` |
| `strokes` + `strokeWeight` + `strokeAlign` | `stroke`, `strokeW`, `strokeAlign` | `border` / `outline` / `box-shadow` inset |
| `effects[DROP_SHADOW\|INNER_SHADOW]` | `shadow: "$token"` | `box-shadow` (inset for inner) |
| `effects[LAYER_BLUR\|BACKGROUND_BLUR]` | `blur` | `filter:blur` / `backdrop-filter` |
| `opacity` | `opacity` (omit if 1) | `opacity` |
| `blendMode` (non-normal) | `blend` | `mix-blend-mode` |
| `clipsContent` | `clip: true` | `overflow:hidden` |
| `visible: false` | node dropped | — |

### Text
| Figma | PDS | CSS |
|---|---|---|
| `fontName.family` / `.style` | folded into `text` token | `font-family` / `font-weight` + `font-style` |
| `fontSize` | `text` token (`"700 20px/1.2"`) | `font-size` |
| `lineHeight` | `text` token (the `/1.2` part) | `line-height` |
| `letterSpacing` | `text.tracking` | `letter-spacing` |
| `textAlignHorizontal/Vertical` | `text.align` | `text-align` / fl-align |
| `textCase` / `textDecoration` | `text.case` / `text.deco` | `text-transform` / `text-decoration` |
| per-character style runs | `runs: [{from,to,…}]` | per-span styles (flagged as complex) |

### Components & variables
| Figma | PDS |
|---|---|
| `COMPONENT` / `COMPONENT_SET` | one entry in the component table |
| `INSTANCE` (`mainComponent`, `componentProperties`, overrides) | `{ ref: "$Comp", overrides: {…} }` |
| `Variable` + `VariableCollection` + modes + aliases | resolved into `plumb_tokens` with `modes`, `alias` chains, `scopes` |
| hard-coded value matching no variable | emitted + flagged as `untokenized` warning |

---

## Appendix B — Tool I/O schemas (sketch)

Indicative shapes; the implementation declares these as Zod `inputSchema`/`outputSchema`.

```jsonc
// plumb_status
in:  {}
out: {
  plugin: { connected: boolean, file: string|null, version: string|null },
  rest:   { configured: boolean },
  legend: { /* key → meaning, the §6.3 vocabulary */ },
  budget: { ceiling: 25000, note: "depths cost-estimated per frame in plumb_outline" },
  next:   "plumb_outline"
}

// plumb_node
in:  { id: string, depth?: number /*=2*/, maxTokens?: number, framework?: "raw"|"css"|"tailwind" }
out: { node: PDSNode, tokensUsed: number, depthUsed: number,
       more?: { id: string, depth: number }, truncated?: boolean, hint?: string,
       next: "plumb_tokens" }

// plumb_verify
in:  {
  nodeId: string,
  viewport: { w: number, h: number },
  rendered: [ { el: string, box: {x,y,w,h}, styles: { /* computed props */ } } ]
}
out: {
  deltas: [ { el: string, kind: string, expected: any, actual: any,
              severity: "error"|"warn"|"info" } ],
  matched: number, checked: number, ok: boolean,
  next: string  // e.g. "Fix the deltas, then call plumb_verify again."
}

// every tool, on failure
out: { error: string, nextAction: string }
```

---

*Plan authored 2026-05-22 · revised 2026-05-22 (v2 — agent contract §6, `plumb_verify` redesigned to a structural render-layout diff, honesty pass on plugin lifecycle and the REST figure, Appendix A mapping table, Appendix B I/O schemas; v2.1 — opt-in `notes` + watch-mode delta responses §7, "design tasks before M1" subsection §14, plugin distribution & publishing §15). Next step: Milestone 0 — scaffold the stdio server and prove the normalizer against Figma node `131:6950`.*
