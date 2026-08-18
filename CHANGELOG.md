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

### Added

- **`plumb-mcp demo`** — the whole design→code→verify loop offline, in one
  command. Runs the real comparison engine over a bundled Plumb Design Spec
  with 13 planted mistakes and prints what it caught, with no Figma token, no
  plugin, no browser and no network. `--json` emits the results for scripting;
  `--pds` prints the design spec it runs against. The 13/13 recall, zero false
  positives, and 71.0 → 96.2 → 100.0 convergence are asserted in
  `src/demo/demo.test.ts`, so the demo fails CI if it stops being true.
- **`docker-compose.yml`** — `docker compose up demo` runs that walkthrough in
  an isolated container with `network_mode: none`; `up bridge` serves the
  bridge and Plumb Studio on a published port; `run --rm mcp` is the stdio MCP
  server. Plus a `.devcontainer` that installs both workspaces and runs the
  demo on attach.
- **`GET /healthz`** on the bridge — liveness plus whether a plugin is actually
  paired, in-flight request count, and uptime. Used as the Compose healthcheck.
- **Structured logging** (`src/logger.ts`) — levelled, zero-dependency, always
  to stderr so stdout stays reserved for MCP framing. `PLUMB_LOG_LEVEL` and
  `PLUMB_LOG_FORMAT=json` control it.
- **Configurable bridge ports** — `PLUMB_BRIDGE_PORT`, `PLUMB_BRIDGE_PORTS`,
  and `PLUMB_BRIDGE_HOST`. Needed for more than ten concurrent sessions on one
  machine, for containers that must publish a known port, and to stop the test
  suite depending on which ports happen to be free.
- **Kubernetes deployment** under `deploy/` — a Helm chart, plain manifests,
  and a Terraform module, all producing the same locked-down deployment:
  ClusterIP, a deny-all NetworkPolicy, non-root with a read-only root
  filesystem and no capabilities, and the `restricted` Pod Security Standard
  enforced on the namespace. The bridge has no authentication of its own, so
  nothing is exposed by default and `deploy/README.md` states plainly what each
  switch opens up — and what does not work in a cluster (the Figma plugin scans
  `127.0.0.1`, so it pairs through `kubectl port-forward`).
- **Continuous design verification** — an opt-in CronJob that renders a URL you
  already serve, diffs it against the Figma node it was built from, and fails
  the Job when they drift. `plumb-mcp verify` already exits non-zero on drift;
  this puts it on a schedule.
- **A `verifier` image target** carrying Chromium and the fonts it needs, for
  the workloads that must render a page. Declared before `runner` in the
  Dockerfile so a plain `docker build .` still produces the slim server image.
- **An IaC CI workflow** — `helm lint` on defaults and on an everything-enabled
  values file, `kubeconform -strict` against real Kubernetes schemas on two
  versions, assertions that the values schema still *rejects* bad input,
  `terraform fmt`/`validate`, both image targets building, Chromium proven to
  render under the chart's exact securityContext, and a regenerate-and-diff so
  the plain manifests can never drift from the chart.
- **Dependabot** across all four npm manifests plus the GitHub Actions, and an
  `npm audit --omit=dev --audit-level=high` gate in CI.
- **Coverage reporting with an enforced floor** (`npm run test:coverage`), and
  an enforced 600-code-line cap per file via ESLint `max-lines`.

### Fixed

- `computeLineHeightRatio` treated a unit-less (`"1.5"`) or percentage
  (`"150%"`) line-height as pixels and divided by the font size, reporting a
  9.4× line-height for a 150% one. Both are now classified before conversion.
- `bridge.reset()` left `lastSeen` set after a plugin disconnected, so health
  and status reported a recent heartbeat for a dead session.
- Every high-severity advisory in the shipped dependency tree (all transitive
  through the MCP SDK) is resolved.

### Changed

- The five files over 1000 lines are split by concern, behind unchanged public
  surfaces: `src/dsl/schema.ts` → a layered `schema/` barrel,
  `src/verify.ts` → `verify/`, `src/normalize/normalize.ts` → five focused
  modules, `figma-plugin/code.ts` → five, and `figma-plugin/emit.ts` →
  `emit/`. `src/assets/search.ts` follows. No file is over 600 code lines.
- `.env.example` documents all 20 environment variables the source reads;
  README gains a full environment-variable table.
- The container user's UID/GID are pinned to 65532 rather than left to Alpine's
  allocator, so a base-image bump cannot move them out from under a Kubernetes
  `runAsUser` or the `/data` ownership.
- Test files 20 → 35, tests 208 → 621, line coverage 30% → 41%.

### Earlier in this cycle

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
