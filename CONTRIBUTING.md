# Contributing to Plumb

Thanks for taking the time to contribute! Plumb is a local Figma MCP server —
it extracts Figma designs as compact specs for coding agents, then verifies what
the agent built. Contributions of every size are welcome, from typo fixes to new
verify checks.

New here? Look for issues labelled
[`good first issue`](https://github.com/tathagat22/plumb-mcp/issues?q=is%3Aissue+is%3Aopen+label%3A%22good+first+issue%22)
— they're scoped to be self-contained, and most can be done **without a Figma
account** thanks to the bundled offline fixtures.

## Prerequisites

- **Node.js 18+** and npm.
- A Figma account is **optional**. The offline fixtures (`scripts/fixtures/`)
  let you build and test the normalizer and verify engine with no credentials.
  You only need a Figma personal-access token for the *live* scripts below.

## Set up

```bash
git clone https://github.com/<your-username>/plumb-mcp
cd plumb-mcp
npm install
npm run typecheck   # strict TS — should pass on a clean checkout
```

## Develop & test

Everything below runs offline unless noted:

```bash
npm run typecheck   # strict TS (server + plugin) — run this before every push
npm run build       # bundle server + plugin + studio
npm run check       # offline regression: fit-to-budget + cache
npm run prove       # normalizer depth/token curve (uses the bundled fixture)
npm run bridge      # simulated plugin + every tool, offline
npm run smoke       # MCP handshake; expects the full tool count
```

Live scripts (need a `.env` with `FIGMA_TOKEN` + `PLUMB_FILE_KEY`; `.env` is
git-ignored — never commit it):

```bash
npm run outline     # list every screen in your file
npm run connect     # end-to-end against a paired plugin
```

To exercise the Figma plugin locally: Figma desktop → **Plugins → Development →
Import plugin from manifest…** → pick `figma-plugin/manifest.json`, run Plumb,
then click **Pair with Plumb**.

## Project layout

The [README "Layout" section](./README.md#layout) maps the tree. The pieces
contributors touch most:

- `src/normalize/` — raw Figma → Plumb Design Spec (PDS).
- `src/verify.ts` — the `plumb_verify` comparison engine.
- `src/tools/` — one file per MCP tool.
- `scripts/` — the offline + live check scripts above.
- `docs/` — the VitePress site (`npm run docs:dev`).

## Pull requests

1. **Branch** off `main` (`fix/...`, `feat/...`, `docs/...`).
2. Keep PRs **focused** — one logical change. Smaller is easier to review.
3. Run `npm run typecheck` (and `npm run check` if you touched normalize/verify)
   before pushing.
4. Use **conventional-commit** subjects, matching the existing history:
   `fix(normalize): …`, `feat(verify): …`, `docs: …`. Keep the message short.
5. Open the PR with a sentence or two on **what** changed and **why**. Link the
   issue it closes.

A maintainer will review — most PRs get a first response within a few days.

## Reporting bugs & ideas

Open an [issue](https://github.com/tathagat22/plumb-mcp/issues). For bugs,
include what you did, what you expected, and what happened (a minimal repro or
the offending Figma node helps a lot). Ideas and questions are welcome too.

By contributing, you agree your contributions are licensed under the project's
[MIT License](./LICENSE).
