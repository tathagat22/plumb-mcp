---
title: Plumb — the two-way Figma MCP: design → code, and prompt → design
description: Local Figma MCP server for Claude Code, Cursor, Windsurf that goes both ways. Design → code: normalised specs out and a verification loop that proves your rendered code matches Figma. Prompt → design: an AI design director that researches references, extracts a brand, and generates a full on-brand Figma page — no extra API key. No REST rate limits, no metered tool-call quotas, no 25k token cap explosions. Works on every Figma plan including Free — a drop-in alternative to Figma's Dev Mode MCP and Framelink.
layout: home
hero:
  name: Plumb
  text: The two-way Figma MCP — design → code, and prompt → design.
  tagline: One direction, designs in and normalised specs out, with a verification loop that drives headless Chrome to prove your code matches Figma. The other, a one-line brief in and a full, on-brand Figma page out — an AI design director that researches references, extracts a brand, generates the page, and critiques its own render. No REST rate limits, no metered tool-call quotas, no 25k token cap explosions, no extra API key. Works on every Figma plan including Free.
  image:
    src: /logo.png
    alt: Plumb plumb-line logo
  actions:
    - theme: brand
      text: Get started
      link: /getting-started
    - theme: alt
      text: Prompt → design
      link: /prompt-to-design
    - theme: alt
      text: Hit a Figma MCP error?
      link: /alternatives
    - theme: alt
      text: Tool reference
      link: /tools/
    - theme: alt
      text: Playground
      link: /play/
    - theme: alt
      text: ★ Star on GitHub
      link: https://github.com/tathagat22/plumb-mcp
features:
  - title: Prompt → design, in Figma
    details: Give Plumb a one-line brief — "a premium fintech dashboard" — and `plumb_studio` composes a full, on-brand page (nav, hero, features, gallery, CTA, footer) as real Figma nodes. Prompt-to-Figma design generation, not a flat mockup.
  - title: An AI design director that grades itself
    details: 'The write direction researches best-in-class reference sites, screenshots them live, and extracts a brand palette + type scale from their computed CSS. Then `plumb_review` blends a structural diff, a design rubric, and the calling agent''s own vision verdict into a score + ranked fixes — agent-as-director, no extra API key, no network model calls.'
  - title: No rate limits, on any plan
    details: Reads and writes through a companion Figma plugin — no REST rate limits (no Framelink 429), no metered per-call quota (no Dev Mode MCP 6-call/month wall), no plan-gating. Free, Starter, Professional, Organization, Enterprise.
  - title: Self-healing loop
    details: '`plumb_verify` diffs your rendered DOM against the design; `plumb_fit` turns that into a 0–100 convergence score and prioritised fixes, so the agent iterates to pixel-perfect. Run it in your editor, the `plumb-mcp fit` CLI, or the browser Playground. No other Figma MCP closes this loop.'
  - title: Token-frugal PDS
    details: Returns a deduplicated design spec instead of the 351,378-token JSON the Dev Mode MCP emits. Tokens shrink to `$c1`, `$t1` refs; auto-layout pre-resolved to flexbox. A 178-node dialog comes back at ~2.6k tokens.
  - title: Everything local
    details: Plugin and server talk over the loopback interface. Nothing about your design ever leaves your machine — the director never calls an external model. No analytics, no third-party endpoints.
  - title: Open source
    details: MIT-licensed. Twenty focused tools — read (Figma → code) and write (prompt → design) — plus an offline `.fig` parser. Issues, source, and roadmap on GitHub.
---

<div style="text-align: center; margin: 64px auto 16px; max-width: 640px;">

## Like Plumb? Give it a ⭐

Plumb is free and MIT-licensed. A star is how other devs find it — and how we know to keep shipping. Takes two seconds.

<a href="https://github.com/tathagat22/plumb-mcp" target="_blank" rel="noopener">
  <img alt="Star plumb-mcp on GitHub" src="https://img.shields.io/github/stars/tathagat22/plumb-mcp?style=social" />
</a>

<p style="margin-top: 16px;">
  <a href="https://github.com/tathagat22/plumb-mcp" target="_blank" rel="noopener"><strong>★ Star us on GitHub →</strong></a>
</p>

</div>
