---
title: Plumb — Figma MCP server for Claude Code, Cursor & Windsurf
description: A Model Context Protocol (MCP) server that connects AI coding agents to Figma files. Token-efficient, no REST rate limits, on any Figma plan.
layout: home
hero:
  name: Plumb
  text: Figma MCP server for AI coding agents.
  tagline: Connect Claude Code, Cursor, Windsurf, and any other Model-Context-Protocol-compatible AI coding agent to your Figma files — token-efficient, no REST rate limits, on any Figma plan including Free.
  image:
    src: /logo.png
    alt: Plumb plumb-line logo
  actions:
    - theme: brand
      text: Get started
      link: /getting-started
    - theme: alt
      text: Tool reference
      link: /tools/
    - theme: alt
      text: GitHub
      link: https://github.com/tathagat22/plumb-mcp
features:
  - title: Token-frugal
    details: Returns a compact normalised design spec instead of a 350,000-token JSON dump. Auto-layout pre-resolved to flexbox, tokens deduped, depth-stable element handles.
  - title: Works on any plan
    details: Reads the file through a companion Figma plugin — no REST rate limits, no metered billing, no plan-gating. Free, Starter, Professional, Organization, Enterprise.
  - title: Everything local
    details: Plugin and server talk over the loopback interface. Nothing about your design ever leaves your machine. No analytics, no third-party endpoints.
  - title: Built for agents
    details: Twelve focused tools — outline, node, assets, screenshot, search, components, verify, plus an offline `.fig` parser — exposed over MCP for Claude Code, Cursor, Windsurf, and any other MCP-compatible client.
  - title: Battle-tested at scale
    details: Validated against a 665-screen production design system with 14,608 component instances. plumb_assets exports 106 icons & images in ~600 ms. plumb_verify produces structured deltas in milliseconds.
  - title: Open source
    details: MIT-licensed. Issues, source, and roadmap on GitHub.
---
