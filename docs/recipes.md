# Recipes

Common workflows. The Plumb tool calls are written as the agent would invoke them — you don't type these yourself, you just describe the goal in chat and the agent picks the right tools.

## Build a single screen from Figma

> *Implement the "Settings → Profile" screen in `src/pages/settings/profile.tsx`.*

What the agent does:

1. `plumb_outline` to find the screen by name.
2. `plumb_node` with `name: "Settings → Profile", depth: 4` to get the PDS.
3. `plumb_tokens` if it needs the raw token table separately.
4. `plumb_assets` with the same name to export icons and images. Files land in `./plumb-assets/settings-profile/`.
5. Writes the component, referencing the exported asset paths and the token table.
6. `plumb_verify` against its own DOM to catch any drift before reporting back.

## Audit how a component is used

> *Where is `Button/Primary` used across this file?*

The agent calls `plumb_components` and walks the `instances` list filtered by `componentId`. Pairs nicely with `plumb_node` (by `id`) to inspect any instance in detail.

## Find every screen mentioning a string

> *Find every screen with the word "Onboarding" in its name.*

`plumb_search` with `query: "Onboarding"`. Returns matches with screen ids; the agent can then `plumb_outline` to see them in context.

## Get a high-resolution screenshot for a PR description

> *Drop a 2× screenshot of the dashboard into this PR description.*

`plumb_screenshot` with `id` and `scale: 2`. Writes a PNG to `./plumb-screenshots/`. The agent attaches the file path.

## Pixel-perfect verification

> *I just finished the Settings screen — check it against the design.*

After your code is rendered (running dev server or a Playwright snapshot), the agent reads each element's `getBoundingClientRect()` and a subset of `getComputedStyle`, builds a `rendered` payload, and calls `plumb_verify`. The response is a sorted list of structured deltas:

```jsonc
{
  "ok": false,
  "matched": 42,
  "deltas": [
    { "el": "title", "kind": "size.w", "expected": 528, "actual": 530, "diff": 2, "severity": "warn" },
    { "el": "cta",   "kind": "fill",    "expected": "#0c8ce9", "actual": "#0a6dc2", "diff": 11, "severity": "error" }
  ]
}
```

The agent fixes errors, re-runs verify until `ok: true`.

## Surgical asset export

For very large files where you don't want every asset, ask:

> *List every asset on the Dashboard screen, but don't export them yet.*

`plumb_assets` with `list: true` — returns a manifest only (id, name, format, parentId) with no file writes.

Then:

> *Pull just the chart-related SVGs.*

`plumb_assets` with `ids: [...]` — surgical mode, exports exactly the listed ids, one file each, no recursion.

## Working without the plugin (REST path)

If Figma desktop isn't available (CI, build server), set `FIGMA_TOKEN` and pass `fileKey` + `id` to any tool that needs design data:

```bash
export FIGMA_TOKEN=figd_your_read_only_token
```

The REST path is metered by Figma. Variables aren't available on this path (they're an Enterprise-only REST endpoint). The plugin path is always preferred when Figma is open.
