# Contributing to Plumb

Thanks for taking the time to contribute! Plumb is a local Figma MCP server —
it extracts Figma designs as compact specs for coding agents, then verifies what
the agent built. Contributions of every size are welcome, from typo fixes to new
verify checks.

New here? Every one of these is self-contained, has a clear "done" test, and
needs **no Figma account** — the bundled fixtures and `npm run demo` cover it.
They are also genuinely wanted, not busywork:

| Where to start | What "done" looks like |
|---|---|
| **Add a verify check.** Pick something Plumb doesn't grade yet — `letter-spacing`, `text-transform`, `object-fit` on images. | A new module in `src/verify/checks/`, wired into the `CHECKS` list in `compare.ts`, plus an entry in `src/demo/faults.ts` proving `npm run demo` catches it and invents nothing. |
| **Split a long file.** `src/review/rubric.ts` (548) and `src/normalize/normalize.ts` (505) are the longest left; the cap is 600 code lines and falling. | Extraction lands with tests for the extracted piece, and `npm test` is green before and after. |
| **Raise the coverage floor.** `src/tools/` is the thinnest area — `query.ts` and `screenshot.ts` have no direct specs. | New specs, then a *separate* commit raising the threshold in `vitest.config.ts`. It only ever goes up. |
| **Teach the rubric something.** `src/review/rubric.ts` grades six dimensions; a seventh (icon-family consistency, say) is a self-contained addition. | A new dimension with its weight, plus specs that break exactly one thing and assert only that dimension reacts. |
| **Tighten the egress NetworkPolicy.** `deploy/helm/plumb` allows public 443 because plain `NetworkPolicy` can't express hostnames. | A Cilium or Calico variant restricted to the hosts in the README's egress table, validated by `npm run deploy:scan`. |

Also labelled on the tracker:
[`good first issue`](https://github.com/tathagat22/plumb-mcp/issues?q=is%3Aissue+is%3Aopen+label%3A%22good+first+issue%22).

## Prerequisites

- **Node.js 20+** and npm (`package.json` sets `engines.node >= 20`).
- A Figma account is **optional**. The offline fixtures (`scripts/fixtures/`)
  let you build and test the normalizer and verify engine with no credentials.
  You only need a Figma personal-access token for the *live* scripts below.

## Set up

From an empty directory, this is the whole thing — no credentials, no Figma
account, no network beyond the install:

```bash
git clone https://github.com/<your-username>/plumb-mcp
cd plumb-mcp
npm ci              # `npm ci`, not `install` — the lockfile is the contract
npm run demo        # the design→code→verify loop, offline. Start here.
npm test            # 600+ specs
npm run typecheck   # strict TS (server + plugin)
npm run lint
npm run build       # bundle server + plugin + studio
```

If any of those fails on a clean checkout, that's a bug — please open an issue.

Prefer a container? `docker compose up demo` does the same walkthrough with
networking disabled, and `.devcontainer/` sets up a full environment.

## Develop & test

Everything below runs offline unless noted:

```bash
npm test            # the vitest suite
npm run test:coverage  # …with the coverage floor CI enforces
npm run demo        # the scored offline walkthrough (exits non-zero on a miss)
npm run typecheck   # strict TS (server + plugin) — run this before every push
npm run lint        # eslint, including the 600-code-line-per-file cap
npm run build       # bundle server + plugin + studio
npm run check       # offline regression: fit-to-budget + cache
npm run prove       # normalizer depth/token curve (uses the bundled fixture)
npm run bridge      # simulated plugin + every tool, offline
npm run smoke       # MCP handshake; expects the full tool count
```

### House rules for changes

- **Ship the test with the change.** A new verify check, a new delta kind, a
  new DSL block — each lands with the spec that pins it. The coverage floor in
  `vitest.config.ts` is a ratchet: raise it as you add, never lower it to make
  a red build green.
- **Files stay under 600 code lines** (ESLint `max-lines`, comments and blanks
  excluded). Hitting the cap means extracting a module, not raising the number.
- **Adding a new verify check?** `src/demo/faults.ts` is the place to prove it:
  add the mistake an agent would make, declare the delta it must produce, and
  `npm run demo` will tell you whether the engine catches it — and whether it
  started inventing findings elsewhere.

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
- `src/verify.ts` + `src/verify/` — the `plumb_verify` comparison engine.
- `src/fit.ts` — the 0–100 convergence score the self-healing loop climbs.
- `src/dsl/schema.ts` + `src/dsl/schema/` — the authoring DSL, layered.
- `src/tools/` — one file per MCP tool.
- `src/demo/` — the offline walkthrough and its fault catalogue.
- `figma-plugin/` — the plugin main thread (`code.ts` + siblings) and the
  write-path executor (`emit.ts` + `emit/`).
- `scripts/` — the offline + live check scripts above.
- `docs/` — the VitePress site (`npm run docs:dev`).

## Pull requests

1. **Branch** off `main` (`fix/...`, `feat/...`, `docs/...`).
2. Keep PRs **focused** — one logical change. Smaller is easier to review.
3. Run `npm test`, `npm run typecheck`, and `npm run lint` before pushing (add
   `npm run check` if you touched normalize/verify). CI runs all of them plus
   the coverage floor, a production dependency audit, the offline demo, and a
   container build.
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
