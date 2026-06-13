---
title: Plumb — Figma MCP with no rate limits, on any plan
description: Local Figma MCP server for Claude Code, Cursor, Windsurf. No REST rate limits, no metered tool-call quotas, no 25k token cap explosions, with a built-in verification loop. Drop-in alternative to Figma's Dev Mode MCP and Framelink — works on every Figma plan including Free.
layout: home
hero:
  name: Plumb
  text: The Figma → code MCP with a verification loop.
  tagline: Designs in, normalised specs out, and `plumb-mcp verify` drives headless Chrome to prove your rendered code matches Figma. No REST rate limits, no metered tool-call quotas, no 25k token cap explosions. Works on every Figma plan including Free.
  image:
    src: /logo.png
    alt: Plumb plumb-line logo
  actions:
    - theme: brand
      text: Get started
      link: /getting-started
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
  - title: No rate limits, on any plan
    details: Reads through a companion Figma plugin — no REST rate limits (no Framelink 429), no metered per-call quota (no Dev Mode MCP 6-call/month wall), no plan-gating. Free, Starter, Professional, Organization, Enterprise.
  - title: Self-healing loop
    details: '`plumb_verify` diffs your rendered DOM against the design; `plumb_fit` turns that into a 0–100 convergence score and prioritised fixes, so the agent iterates to pixel-perfect. Run it in your editor, the `plumb-mcp fit` CLI, or the browser Playground. No other Figma MCP closes this loop.'
  - title: Token-frugal PDS
    details: Returns a deduplicated design spec instead of the 351,378-token JSON the Dev Mode MCP emits. Tokens shrink to `$c1`, `$t1` refs; auto-layout pre-resolved to flexbox. A 178-node dialog comes back at ~2.6k tokens.
  - title: Multi-agent connect
    details: One Figma plugin pairs with multiple `plumb-mcp` servers at once — different Claude / Cursor / Windsurf sessions on different projects can share the same Figma file with zero contention.
  - title: Everything local
    details: Plugin and server talk over the loopback interface. Nothing about your design ever leaves your machine. No analytics, no third-party endpoints.
  - title: Open source
    details: MIT-licensed. Fifteen focused tools + offline `.fig` parser. Issues, source, and roadmap on GitHub.
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
