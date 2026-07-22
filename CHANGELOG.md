# Changelog

All notable changes to `plumb-mcp` are documented here. Format loosely
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions
correspond to npm/git tags.

For the full commit-level history, see `git log` or the
[GitHub tags](https://github.com/tathagat22/plumb-mcp/tags) — this file
starts detailed tracking from the production-hardening pass below and is
maintained per release going forward. Earlier versions (through v0.13.2)
are summarized only briefly.

## [Unreleased]

Production-hardening pass — crash/security fixes, resource-leak fixes, and
CI/lint infrastructure, none of which change the tool contract:

- Global `uncaughtException`/`unhandledRejection` guards so one bad tool
  call can't take down every concurrent session sharing the bridge process.
- Bridge WebSocket messages are now validated before use instead of trusted
  as well-formed; malformed messages are dropped and logged, not fatal.
- A shared URL allowlist blocks `plumb_import_web` and `plumb_brand` from
  navigating to `file:`/loopback/private-IP addresses.
- `plumb_screenshot`'s `out` path is confined to the cwd/screenshots root;
  `plumb_fig_outline`/`plumb_fig_node` require a `.fig` extension.
- Tree walks that previously recursed on untrusted input (Figma pre-walk,
  the HTML/web semantic-graph builder) are now iterative, and pasted
  DSL/PDS documents are bounds-checked before validation — pathological
  input degrades gracefully instead of risking a stack overflow.
- Timeouts added everywhere a network call previously had none: Figma REST,
  Google Fonts, the hand-rolled CDP client, and the Anthropic fit generator.
- `plumb-mcp init` now gitignores the config files it writes and warns if a
  real `FIGMA_TOKEN` would land in a file git already tracks.
- Bridge upload/asset-request bookkeeping now has a TTL and is swept
  immediately on plugin disconnect, instead of leaking indefinitely.
- The plugin's shared write queue times out a stuck operation so it can't
  strand another session's request past its own watchdog.
- SIGINT/SIGTERM now close any open headless-Chrome sessions before exit; a
  failed Chrome launch cleans up its process and temp profile dir.
- Real CI (typecheck, lint, test, build) now runs on every push/PR — the
  Vitest suite was previously never run in CI at all. Added a minimal
  ESLint config.

## [0.13.x] — prompt→design, Studio, security badges

Prompt→design write direction (`plumb_studio`/`plumb_brand`/`plumb_design`/
`plumb_review`), Plumb Studio (the live local cockpit), and the bespoke
marketing homepage shipped across v0.13.0–v0.13.2.

## [0.12.0] — self-healing fit loop

`plumb_fit`, the autonomous `plumb-mcp fit` CLI, and the browser playground.

## Earlier

v0.6.0 through v0.10.9 built out the core Figma → code read path: PDS
normalization, the plugin bridge, `plumb_verify`, design tokens, variables,
multi-agent session support, and progressive fidelity work (blend modes,
gradients, masks, motion). See git tags for exact scope per version.
