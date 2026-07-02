# `plumb_design`

Author a design in Plumb's high-level Design DSL and build it into Figma. **The write primitive** — full control over pages, sections, and blocks.

## How it works

`plumb_design` is the write direction at its lowest level: you hand it a **Design DSL document** (semantic `pages → sections → blocks` + brand tokens), it validates, compiles, and builds:

```
DSL document → validate → compile to PDS → lower to emit-plan → build via the plugin
```

- The DSL is validated against `DesignDocSchema` (version `"1"`, `brand`, `pages[]`).
- Assets referenced in the doc are **sourced live** — icons travel inline as SVG, photos are staged as bytes for the plugin to pull (set a free photo API key for on-brief imagery; otherwise a placeholder is used and a warning is returned).
- It returns the created node ids keyed by **authored element handle** (`el`) and an `authoredPath` — the join keys you feed to [`plumb_review`](/tools/plumb_review).

Where `plumb_studio` *composes* the DSL for you from a brief, `plumb_design` builds a DSL **you** author — use it when you want section-by-section control.

## Inputs

| Field | Type | Notes |
|---|---|---|
| `doc` | object · required | A Plumb Design DSL document (version `"1"`: `brand` + `pages` of semantic sections). Validated against `DesignDocSchema`. Accepts a parsed object or a JSON string. |
| `brief` | object · optional | Design-brief intake — records author intent (`name`, `description`, `audience`, `tone[]`, `industry`, `keywords[]`, `references[]`, `brandColors[]`, `mustHave[]`, `avoid[]`) alongside the build. All fields optional. |
| `target` | object · optional | Where to build. `{ kind: "page" \| "into" \| "replace", nodeId?, pageName?, pos? }`. `page` — new top-level frame on a page; `into` — append inside an existing node; `replace` — swap a node in place (`into` / `replace` need `nodeId`). Defaults to a new frame on the current page. |
| `mode` | `"create"` \| `"sync"` · optional | `create` (default) — fresh nodes. `sync` — idempotent re-apply keyed on stable `plumbKey`; pair with `prune`. |
| `prune` | boolean · optional | `sync` only — delete built nodes no longer in the design. |
| `reveal` | boolean · optional | Scroll + select the built root in Figma when done. |
| `pageWidth` | number · optional | Layout width hint for pages that don't set their own. |
| `dryRun` | boolean · optional | Compile + lower only; do **not** touch Figma. Returns plan stats + warnings so you can sanity-check first. |

A real build requires the Plumb plugin paired; a `dryRun` does not.

## Returns

```jsonc
{
  "source": "plugin",
  "planId": "plan-1720-abc123",
  "rootId": "512:4",
  "rootKey": "hero-root",
  "created": 137,
  "updated": 0,
  "deleted": 0,
  "ids": { "hero": "512:9", "cta": "512:71", /* authored el → node id */ },
  "authoredPath": "/tmp/plumb-authored-plan-1720-abc123.json",
  "warnings": [],
  "summary": "built \"Pricing\" — 137 created, 0 updated, 0 deleted",
  "next": "Built. Run plumb_review with { id: rootId, ids, authoredPath } to score built-vs-authored and get the fix list."
}
```

A `dryRun` returns `{ dryRun: true, planId, pages, nodes, assets, fonts, warnings, next }` instead — compiled but not built.

## Example — the prompt→design flow

```txt
"Author a two-page DSL — a landing page and a pricing page — for our brand and
 build it with plumb_design. Then plumb_review the rootId; if it's not done,
 apply the topFixes and re-run plumb_design with mode:"sync" so plumbKey holds."
```

## When the agent should use it

- You want **exact control** over the sections, copy, and brand tokens — author the DSL yourself rather than letting `plumb_studio` compose it.
- The refine step of any director loop: re-apply with `mode: "sync"` (keeps `plumbKey`) after acting on `plumb_review`'s fixes.
- `dryRun: true` to validate a DSL and inspect plan stats before writing to Figma.

## Notes

`ids` (authored `el` → Figma node id) and `authoredPath` (the compiled PDS) are the join keys for [`plumb_review`](/tools/plumb_review)'s structural diff — always pass them both. For a one-call brief → page, use [`plumb_studio`](/tools/plumb_studio); for on-brief imagery, resolve assets with [`plumb_source`](/tools/plumb_source).
