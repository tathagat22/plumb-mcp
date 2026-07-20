

<p align="center">
  <img src="./docs/public/banner.png" alt="Plumb — Figma ↔ AI coding, plumbed both ways." width="100%">
</p>

# Plumb (`plumb-mcp`) — the two-way Figma MCP: design → code, and prompt → design

<p align="center">
  <a href="https://github.com/tathagat22/plumb-mcp"><img alt="GitHub stars" src="https://img.shields.io/github/stars/tathagat22/plumb-mcp?style=social"></a>
  &nbsp;
  <a href="https://www.npmjs.com/package/plumb-mcp"><img alt="npm version" src="https://img.shields.io/npm/v/plumb-mcp?color=cb3837&logo=npm&logoColor=white"></a>
  &nbsp;
  <a href="https://www.npmjs.com/package/plumb-mcp"><img alt="npm weekly downloads" src="https://img.shields.io/npm/dw/plumb-mcp?color=cb3837&logo=npm&logoColor=white"></a>
  &nbsp;
  <img alt="MIT license" src="https://img.shields.io/badge/license-MIT-blue">
</p>

<p align="center"><b>⭐ If Plumb saves you tokens — or designs you a page — <a href="https://github.com/tathagat22/plumb-mcp">star it on GitHub</a> so others can find it.</b></p>

**Plumb is the Figma MCP server that goes both ways.** Point it at a design and it returns a compact, normalised spec your coding agent can build from — then proves the code matches with a verification loop. Point it at a *prompt* and it turns into an **AI design director**: it researches real best-in-class reference websites, extracts a brand, and **generates a full, on-brand Figma design on your canvas** — then critiques its own render and iterates until it's good.

> **Figma → code** (extract, verify, self-heal) &nbsp;•&nbsp; **prompt → design** (research → brand → generate → critique). One MCP server, both directions.

📖 Full docs: **<https://tathagat22.github.io/plumb-mcp/>** &nbsp;·&nbsp; 📦 npm: [`plumb-mcp`](https://www.npmjs.com/package/plumb-mcp) &nbsp;·&nbsp; 🇨🇳 [简体中文](./i18n/README.zh-cn.md) &nbsp;·&nbsp; 🇯🇵 [日本語](./i18n/README.ja.md) &nbsp;·&nbsp; 🇰🇷 [한국어](./i18n/README.ko.md)

<p align="center">
  <a href="cursor://anysphere.cursor-deeplink/mcp/install?name=plumb&config=eyJjb21tYW5kIjoibnB4IiwiYXJncyI6WyIteSIsInBsdW1iLW1jcCJdfQ=="><img src="https://cursor.com/deeplink/mcp-install-dark.svg" alt="Add to Cursor" height="32"></a>
  &nbsp;
  <a href="https://insiders.vscode.dev/redirect/mcp/install?name=plumb&config=%7B%22type%22%3A%22stdio%22%2C%22command%22%3A%22npx%22%2C%22args%22%3A%5B%22-y%22%2C%22plumb-mcp%22%5D%7D"><img src="https://img.shields.io/badge/Install_in_VS_Code-0098FF?style=for-the-badge&logo=visualstudiocode&logoColor=white" alt="Install in VS Code" height="32"></a>
</p>

Built for coding agents — Claude Code, Cursor, Windsurf, anything MCP-compatible. It reads Figma through a desktop-app plugin (no REST rate limits, works on every plan including Free), *writes* new designs back through the same plugin, and returns compact normalised specs instead of the multi-hundred-thousand-token JSON the Figma API emits.

---

## Two directions, one server

### ← Figma → code (read direction)
Your agent extracts a screen as a compact **Plumb Design Spec (PDS)** — auto-layout pre-resolved to flexbox, design tokens deduped — builds the UI, then calls `plumb_verify` / `plumb_fit` to diff the rendered result against the design and self-correct to pixel-perfect. The only Figma MCP that **closes the loop on code**.

### → prompt → design (write direction — the design director)
Give Plumb a one-line brief — *"a premium fintech dashboard"* — and it acts like a senior designer working live in your Figma:

1. **Researches references** — finds best-in-class sites for your brief (Linear, Stripe, Mercury…) and **screenshots them live** onto a References page.
2. **Extracts a brand** — reads their computed CSS into a coherent palette + type scale, laid down as a Brand board.
3. **Generates the design** — composes a full, on-brand page (nav, hero, features, gallery, CTA, footer) from a high-level design DSL, built as real Figma nodes.
4. **Critiques its own render** — the calling agent (Claude Code / any MCP client with vision — **no extra API key**) grades the screenshot; Plumb blends that with a deterministic design rubric and a structural diff, then hands back a ranked fix list and iterates until it clears the bar.

That's **prompt-to-Figma design generation with a self-improving director loop** — not a one-shot mockup.

---

## How Plumb is different

Other Figma MCP servers you may know:

- **Figma's official Dev Mode MCP** — bidirectional, but plan-gated and metered.
- **Framelink** — thin REST wrapper. Two tools. No verification, inherits rate limits.
- **cursor-talk-to-figma** — bidirectional automation for designers working *in* Figma.

Plumb is the only one that both **closes the loop on code** *and* **directs new design generation.** `plumb_verify` tells you whether shipped code actually matches the design; `plumb_fit` turns that into a self-healing loop. And on the write side, `plumb_studio` / `plumb_brand` / `plumb_design` / `plumb_review` turn a prompt into a designed, critiqued Figma file — no design skills, no separate design tool, no extra model key.

---

## Are you hitting one of these?

If your agent landed here from an error, Plumb probably solves it.

| Error you're seeing | Why Plumb fixes it |
|---|---|
| `Figma Dev Mode MCP exceeded the 25k token cap` · `351,378 tokens observed` | PDS dedups design tokens (`$c1`, `$t1` …) and pre-resolves auto-layout to flexbox. A 178-node dialog comes back at ~2.6k tokens. |
| `Dev Mode MCP: 6 tool calls per month limit` · `Starter plan tool-call limit reached` | Plumb's plugin path has no per-call quota on any plan, including Free. |
| `Framelink figma-developer-mcp HTTP 429` · `Figma REST API rate limit exceeded` | The plugin path doesn't touch REST. Zero rate limits. |
| `Variables API requires Enterprise plan` · `403 Forbidden on variables` | Plumb reads Variables through the Figma Plugin API — works on every plan. |
| `Figma MCP returned 85% wrong layout` · hallucinated structure | Plumb returns structured PDS (not parsed prose) and ships `plumb_verify` + a `plumb-mcp verify` CLI that diffs your rendered DOM against the design. |
| *"How do I generate a Figma design from a prompt?"* · *"AI that designs UI in Figma"* | `plumb_studio` — brief → researched references → extracted brand → a full composed Figma page, critiqued and refined. |

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
```

**Then, in your agent:**

```txt
# Figma → code
"Extract the Settings screen with Plumb and build it, then plumb_fit until it matches."

# prompt → design
"Use plumb_studio to design a premium fintech dashboard, then screenshot it and
 run plumb_review as the director until the score clears 90."
```

Other install paths: `npx plumb-mcp` · `docker run --rm -i ghcr.io/tathagat22/plumb-mcp:latest` · [build from source](https://github.com/tathagat22/plumb-mcp).

---

## The twenty-four MCP tools

### Read — Figma → code

| Tool | What it does |
|---|---|
| `plumb_status` | Self-description, key legend, connection state. Call first. |
| `plumb_outline` | Every screen in the file (id, name, size). |
| `plumb_node` | Extract a screen as compact PDS — by id or by name. |
| `plumb_query` | Pull a slice (`skeleton` / `buttons` / `text` / `components` / `role`) when a full screen would blow the token budget. |
| `plumb_describe` | Text-only visual description — for image-blind harnesses. |
| `plumb_tokens` | Design-token table (colours, type, radii, shadows). |
| `plumb_selection` | The user's live Figma selection. |
| `plumb_assets` | Export icons (SVG) + images (PNG) — recursive, list, or surgical by ids. |
| `plumb_screenshot` | Render any node to PNG/JPG. |
| `plumb_search` | Find nodes by name and/or type. |
| `plumb_components` | List components + instance usages, plus an opt-in design-system health report (unused components, near-duplicate names, variant outliers). |
| `plumb_verify` | Diff rendered layout against the design — ΔE2000 colour, shadow/rotation/flex checks. |
| `plumb_fit` | The self-healing loop: verify + a 0–100 convergence score + prioritised fixes. |
| `plumb_fig_outline` / `plumb_fig_node` | Headless: read a saved `.fig` file from disk. No Figma desktop, no token. |
| `plumb_diff` | Semantic diff between two PDS snapshots — "the hero moved from (0, 0) to (0, 120)", not a JSON diff. |
| `plumb_audit` | Heuristic accessibility checks — text contrast, button touch-target size. |
| `plumb_import_web` | Import a live webpage's structure and semantics — no Figma connection needed. Same role classifier Figma designs use. |
| `plumb_emit_react` | Deterministic React/JSX generator from a PDS or a `plumb_import_web` result — same emitter, either source. |

### Write — prompt → design (the director)

| Tool | What it does |
|---|---|
| `plumb_studio` | **The design director.** One brief → researched references → extracted brand → a full composed Figma page. Returns the node ids + authored spec so you can critique and refine. |
| `plumb_brand` | Brief → live-screenshots best-in-class reference sites + a synthesized brand palette/type board on the canvas. |
| `plumb_design` | Author a design from Plumb's high-level Design DSL and build it into Figma (full control: pages, sections, components, motion). |
| `plumb_review` | The critique loop: blends a structural diff, a deterministic design rubric, and the calling agent's own vision verdict into one score + ranked fixes. **No API key** — the agent that drives the MCP server *is* the creative director. |
| `plumb_source` | Resolve on-brief assets (icons, photos, illustrations, patterns) for a design. |

---

## Why it wins on tokens and quality

- **Compact specs.** A 178-node dialog that is 351k tokens of Figma REST JSON comes back as ~2.6k tokens of PDS — deduped tokens, flexbox-resolved layout, depth-stable handles.
- **Verified, not vibes.** `plumb_verify` / `plumb_fit` diff the *rendered* result against the design (ΔE2000 perceptual colour, shadow, rotation, flex-child, fill-stack) — no pixel diff, runs in CI.
- **Designed, not defaulted.** The write direction bakes real design craft in: size-aware letter-spacing, generous section rhythm, extracted brand palettes from real references, gradient text, full-bleed and asymmetric layouts, and a vision-based director that grades the render and pushes it up.
- **Understands structure, not just geometry — and not just Figma.** Plumb tags nav/hero/footer/sidebar/card conservatively on top of the raw tree (`node.pattern` — silence over a guess when the signals don't line up) and builds on it: `plumb_diff` narrates changes by role, `plumb_audit` flags contrast and touch-target issues, `plumb_query`'s `select: "role"` and `plumb_node`'s `collapseRoles` filter and compress by the same labels. The same underlying model reads a live webpage too — `plumb_import_web` extracts structure and roles from any URL, no Figma involved — and `plumb_emit_react` generates deterministic React/JSX from either source.

---

## Two data paths

| | Plugin (primary) | REST (secondary, headless) |
|---|---|---|
| Rate-limited | **No.** Reads the in-memory document. | Yes. Free/Starter get very low budgets. |
| Token required | No. | Yes — `FIGMA_TOKEN`. |
| Variables | **Yes**, every plan. | No — Variables REST is Enterprise-only. |
| Write (generate designs) | **Yes.** | No. |
| Headless / CI | No (needs Figma open). | Yes. |

Tools auto-pick the path. With the plugin paired, omit `fileKey` and pass `id` or `name`.

---

## Configuration

`.env` (gitignored — never commit secrets; Plumb loads it on startup):

```bash
FIGMA_TOKEN=figd_your_read_only_token   # REST path only
# prompt→design photo providers (all free — for on-brief imagery)
UNSPLASH_ACCESS_KEY=…
PEXELS_API_KEY=…
PIXABAY_API_KEY=…
```

- **Cache** — `~/.cache/plumb/v1/` (override with `PLUMB_CACHE_DIR`).
- **Assets** — `./plumb-assets/<screen>/` · **Screenshots** — `./plumb-screenshots/`.

---

## Security

- Loopback-only WebSocket bridge; a single paired plugin at a time (one deliberate click).
- Zero telemetry. No personal-access token needed for the plugin path.
- The write direction never calls an external model — the AI agent already driving the MCP server does the design judgment.

---

## Contributing

Contributions welcome — from typo fixes to new verify checks to design-director upgrades. See [`CONTRIBUTING.md`](./CONTRIBUTING.md). New here? Browse the [`good first issue`](https://github.com/tathagat22/plumb-mcp/issues?q=is%3Aissue+is%3Aopen+label%3A%22good+first+issue%22) label.

---
[![MseeP.ai Security Assessment Badge](https://mseep.net/pr/tathagat22-plumb-mcp-badge.png)](https://mseep.ai/app/tathagat22-plumb-mcp)
[![Verified on MseeP](https://mseep.ai/badge.svg)](https://mseep.ai/app/a9f8a315-d08c-48df-a817-c65ed22c2730)

## License

MIT © Tathagat Maitray. See [`LICENSE`](./LICENSE).
