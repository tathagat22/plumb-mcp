# `plumb_source`

Resolve on-brief assets — icons, photos, avatars, illustrations, patterns — for the write direction. **The asset resolver.**

## How it works

`plumb_source` queries every asset provider in parallel and ranks the results with one scoring function — including **pick-the-right-icon-pack**, so a design uses one consistent icon family instead of a mismatched grab-bag. Keyless providers (Iconify, Lorem Picsum, DiceBear) always work; Unsplash / Pexels / Pixabay activate when their API key is in env.

Two modes:

- **`search`** (default) — return ranked candidates, metadata only (no bytes). Cheap; use it to see what's available and which icon pack was locked.
- **`fetch`** — resolve the best match, download its bytes to a local folder, and return the path (plus inline SVG / a small `data:` URI). Never fails: a total miss degrades to a deterministic placeholder.

## Inputs

| Field | Type | Notes |
|---|---|---|
| `query` | string · required | What to look for, e.g. `"rocket launch"` or `"shopping cart"`. |
| `mode` | `"search"` \| `"fetch"` · optional | `search` (default) returns ranked candidates; `fetch` downloads the best. |
| `kind` | enum · optional | Constrain to one asset kind: `icon`, `photo`, `illustration`, `avatar`, `pattern`, `font`, `mockup`, `logo`, `generated`. |
| `style` | string[] · optional | Preferred style tags (ranking hint): `flat`, `line`, `outline`, `filled`, `duotone`, `3d`, `photo`, `illustration`, `hand-drawn`, `geometric`, `gradient`. |
| `weight` | enum · optional | Icon weight preference: `thin`, `light`, `regular`, `medium`, `bold`. |
| `aspect` | number · optional | Target width/height ratio (ranking hint). |
| `minWidth` | number · optional | Minimum acceptable pixel width. |
| `palette` | string[] · optional | Brand hex colours — recolours monotone SVG icons. |
| `seed` | string · optional | Deterministic seed for avatars / placeholders. |
| `provider` | string · optional | Restrict to one provider id (`iconify`, `unsplash`, `pexels`, `pixabay`, `dicebear`, `picsum`, …). |
| `w` / `h` | number · optional | Desired width / height (photos / placeholders). |
| `limit` | number · optional | Max candidates in `search` mode. Default 16. |
| `inline` | boolean · optional | `fetch` mode: also return the bytes inline (SVG markup / small `data:` URI). |

## Returns

**`search`** — ranked candidates, no bytes:

```jsonc
{
  "mode": "search",
  "query": "shopping cart",
  "iconPack": "lucide",
  "providersRun": ["iconify", "unsplash"],
  "providersDropped": [],
  "count": 16,
  "candidates": [
    { "id": "lucide:shopping-cart", "provider": "iconify", "kind": "icon",
      "title": "shopping-cart", "style": ["line"], "w": 24, "h": 24,
      "url": "…", "license": "ISC", "attribution": null, "score": 0.92 }
  ],
  "next": "Call plumb_source again with mode:'fetch' (same args) to download the top match."
}
```

**`fetch`** — best match downloaded to disk:

```jsonc
{
  "mode": "fetch",
  "query": "rocket launch",
  "resolved": true,
  "placeholder": false,
  "provider": "unsplash",
  "kind": "photo",
  "ext": "jpg",
  "path": "./plumb-assets/sourced/rocket-launch-9f3a2b1c04.jpg",
  "bytes": 184213,
  "w": 1600, "h": 1067,
  "license": "Unsplash",
  "attribution": "Photo by …",
  "next": "Use `path` when building, or pass these bytes to the plugin inbound channel during apply. Honor `attribution` where the license requires it."
}
```

## Example — the prompt→design flow

```txt
"Before authoring the DSL, plumb_source (mode:'search') for a 'line' style
 'shopping cart' icon to see which icon pack locks in, then fetch the hero
 photo — plumb_source({ query: 'city skyline dusk', kind: 'photo', mode: 'fetch' })
 — and reference its `path` in the plumb_design doc."
```

Note that [`plumb_studio`](/tools/plumb_studio) and [`plumb_design`](/tools/plumb_design) already resolve referenced assets during compile, so `plumb_source` is for when you want to preview or pin a specific asset ahead of the build.

## When the agent should use it

- To **see the options** (and which icon pack was chosen) before committing a design to one icon family.
- To pin a specific hero photo / illustration and reference its `path` in a `plumb_design` doc.
- Any time a build needs on-brief imagery and you want to control exactly which asset lands.

## Notes

Set any of `UNSPLASH_ACCESS_KEY` / `PEXELS_API_KEY` / `PIXABAY_API_KEY` (all free) for real photography — without them, photo queries fall back to a keyless Picsum placeholder. Fetched bytes are written content-addressed under `./plumb-assets/sourced/` (override the root with `PLUMB_ASSETS_DIR`). Honour `attribution` wherever a provider's license requires it.
