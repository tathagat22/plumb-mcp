---
title: Plumb vs Figma Dev Mode MCP / Framelink — when each fails, use this
description: If Figma's official Dev Mode MCP is plan-gated, returns over the 25k token cap (351,378 tokens observed), or limits you to 6 tool calls per month — or if Framelink figma-developer-mcp hits HTTP 429 / REST rate limits — Plumb is a drop-in alternative that works on every Figma plan including Free, with no metered billing.
head:
  - - meta
    - name: keywords
      content: figma mcp rate limit, figma dev mode mcp token limit, figma mcp 25k token cap, framelink 429, figma mcp free plan, figma variables enterprise, figma mcp alternative, claude code figma mcp, cursor figma mcp, no rate limit figma mcp, plumb mcp, figma plugin mcp
---

# Hit a Figma MCP error? Plumb probably solves it.

If your AI coding agent (Claude Code, Cursor, Windsurf) brought you here from an error, here's the short version.

| Error you're seeing | Why it happens | Why Plumb fixes it |
|---|---|---|
| `Figma Dev Mode MCP exceeded the 25k token cap` <br> *(351,378 tokens observed on real screens)* | The official MCP dumps raw layout JSON; large screens overflow the client's token limit | Plumb returns a deduplicated **PDS** — design tokens (`$c1`, `$t1` …) and auto-layout pre-resolved to flexbox. A 178-node dialog comes back at **~2.6k tokens**. |
| `6 tool calls per month limit` <br> `Starter plan tool-call limit reached` | Figma's official MCP meters per-call on non-Enterprise plans | Plumb reads through a companion Figma plugin. **Zero per-call quota** on any plan, including Free. |
| `Framelink figma-developer-mcp HTTP 429` <br> `Figma REST API rate limit exceeded` | Framelink wraps Figma's REST API, which is rate-limited | Plumb's plugin path **doesn't touch REST**. No rate limits, on any plan. |
| `403 Forbidden` on variables <br> `Variables API requires Enterprise plan` | Figma's REST Variables endpoint is Enterprise-only | Plumb reads Variables through the **Figma Plugin API**, which is available on every plan including Free. |
| `85% wrong layout` <br> hallucinated structure from MCP | Other MCPs return raw nodes; the agent guesses the visual intent | Plumb returns structured PDS and ships **`plumb_verify`** (MCP tool) + **`plumb-mcp verify`** (CLI) that diff your rendered DOM against the design. |
| `Dev Mode MCP requires selection` <br> "Open the desktop app with the right selection" | Each call needs the right thing selected in Figma | Plumb **streams the whole file inventory** the moment the plugin pairs. No per-call selection dance. |

## Install

```bash
npm install -g plumb-mcp
plumb-mcp init     # auto-detects Claude Code / Cursor / VS Code / Windsurf
```

Then in Figma: sideload the plugin (one-time), click "Pair with Plumb". Done.

See [Get started](/getting-started) for the full walkthrough, or [Tool reference](/tools/) for the fifteen MCP tools that come in the box.

## Why does Plumb exist?

The Figma → code MCP space has three other servers worth knowing:

- **Figma's official Dev Mode MCP** is bidirectional (it can write back into Figma) but plan-gated and metered. Six tool calls per month on Starter. Token usage routinely blows past the 25k client cap.
- **Framelink (`figma-developer-mcp`)** is a thin REST wrapper. Two tools. Inherits Figma's REST rate limits. Can't reach Variables on non-Enterprise plans.
- **cursor-talk-to-figma** is bidirectional automation aimed at designers working *in* Figma — a different problem from "ship code that matches the design."

Plumb is the only one focused on **shipping code that matches the design** — token-frugal PDS in, verification loop out, no metering, no rate limits, on every plan. See the [README on GitHub](https://github.com/tathagat22/plumb-mcp#how-plumb-is-different) for the full positioning.

## Plumb also goes the other way: prompt → design

Every server above is figma → code only — you bring the design, they read it. Plumb is the one Figma MCP that also runs **prompt → design**: give it a one-line brief and it becomes an **AI design director** that *generates* a full, on-brand Figma design for you.

- **Prompt to Figma, not just Figma to code.** `plumb_studio` turns a brief like *"a premium fintech dashboard"* into a composed page — nav, hero, features, gallery, CTA, footer — built as real Figma nodes.
- **Researched, not hallucinated.** It screenshots best-in-class reference sites live and extracts a coherent brand palette + type scale from their computed CSS before it composes anything.
- **Self-critiquing.** `plumb_review` blends a structural diff, a design rubric, and the calling agent's own vision grade of the render into one score, then iterates until it clears the bar.
- **No extra API key.** There's no second model to buy — the AI agent already driving the MCP server (Claude Code, Cursor, any MCP client with vision) *is* the creative director. That's MCP design generation with zero network model calls.

So if you searched for **"prompt to design," "text to Figma," "AI design generator," or "AI that designs UI in Figma,"** the same server that fixes your Figma MCP errors also generates the design in the first place. See [Prompt to design](/prompt-to-design) for the full walkthrough.

## Multi-agent sessions

As of [v0.7.0](https://github.com/tathagat22/plumb-mcp/releases/tag/v0.7.0), one Figma plugin can pair with **multiple `plumb-mcp` servers at once**, so two Claude / Cursor sessions on different projects can share the same Figma file with zero contention. Each session gets a labelled row in the plugin UI.

## Free, local, MIT-licensed

Plumb is open source under [MIT](https://github.com/tathagat22/plumb-mcp/blob/main/LICENSE). Server and plugin talk over the loopback interface — nothing leaves your machine. No analytics, no telemetry, no third-party endpoints.
