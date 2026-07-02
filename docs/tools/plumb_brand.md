# `plumb_brand`

Brief → live reference screenshots + a synthesized brand board on the canvas. **The research pass.**

## How it works

Where [`plumb_studio`](/tools/plumb_studio) composes a full page, `plumb_brand` stops at the foundations: it turns a one-line brief into a **Brand page** — real reference screenshots, extracted colour swatches, and a type scale — so you can see and approve the direction before building anything downstream. No API key, no network model calls:

```
brief → discover references → screenshot them live → blend a palette → build a Brand board
```

1. **Discovers references.** Best-in-class sites for the brief (plus any explicit `references`, studied first).
2. **Screenshots them live** in headless Chrome.
3. **Blends a palette across every capture** — the most-agreed background / text / accent wins over any single site's quirks, so the brand is coherent rather than a copy of one page.
4. **Materialises real Figma tokens** — a `"Brand"` Variable collection + named text styles are applied ahead of the geometry (best-effort; a foundations hiccup won't sink the board).
5. **Builds the Brand board** — a single 1440-wide page of reference screenshots + swatches + type scale, through the same DSL → PDS → emit-plan write path.

## Inputs

| Field | Type | Notes |
|---|---|---|
| `brief` | string · required | One-line description of what's being built, e.g. `"a premium fintech dashboard"`. Drives reference discovery + palette. |
| `count` | number · optional | How many reference sites to study + screenshot. Default 4. |
| `references` | string[] · optional | Explicit reference URLs to include first — always studied ahead of the discovered catalogue. |

Requires the Plumb plugin to be paired — `plumb_brand` writes through the plugin path.

## Returns

```jsonc
{
  "references": [
    { "name": "Linear",  "url": "https://linear.app" },
    { "name": "Mercury", "url": "https://mercury.com" }
  ],
  "captured": 4,
  "misses": [],
  "brand": { /* synthesized semantic palette */ },
  "rootId": "88:2",
  "foundationsWarnings": [],
  "summary": "built brand board"
}
```

## Example — the prompt→design flow

```txt
"Run plumb_brand for 'a calm meditation app' with 5 references so I can see the
 palette and inspiration, then use plumb_studio (or plumb_design) to build the
 actual page from that direction."
```

## When the agent should use it

- **Before** committing to a full build — establish and eyeball the palette + type scale first.
- When you want the extracted brand as real Figma Variables + text styles a whole file can bind to, not just a one-off page.

## Notes

The palette is blended across *all* captured references, not just the first — this is the difference from `plumb_studio`, which seeds the page palette from the first good capture. To go straight from brief to a full composed page, use [`plumb_studio`](/tools/plumb_studio).
