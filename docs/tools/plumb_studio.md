# `plumb_studio`

The design director. One-line brief in, a full, on-brand Figma page out — **prompt to design** in a single call. **The headline write tool.**

## How it works

Give Plumb a brief — *"a premium fintech dashboard"* — and it runs the whole director pass server-side, with **no extra API key** and no network model calls:

```
brief → research references → screenshot them live → extract a brand → compose the page → build it in Figma
```

1. **Researches references.** Discovers a diverse set of best-in-class sites for the brief (and any explicit `references` you pass, always studied first).
2. **Screenshots them live.** Renders each reference in headless Chrome onto in-memory PNGs, reused later as hero / gallery imagery.
3. **Extracts a brand.** Reads the computed CSS of the first good capture into a coherent semantic palette + type scale.
4. **Composes a full page.** Authors a real marketing page from the Design DSL — nav, hero, features, a reference-imagery gallery, a content split, a CTA, and a footer — with copy derived from the brief.
5. **Builds it.** Compiles DSL → PDS → emit-plan and writes it through the plugin (the same write path `plumb_design` uses), onto a named page.

It returns the created node ids and an `authoredPath` so you can hand the build straight to [`plumb_review`](/tools/plumb_review) for the critique loop.

## Inputs

| Field | Type | Notes |
|---|---|---|
| `brief` | string · required | One-line description of what's being built, e.g. `"a premium fintech dashboard"`. Drives reference discovery, palette, and copy. |
| `count` | number · optional | How many reference sites to study + screenshot. Default 4. |
| `references` | string[] · optional | Explicit reference URLs to include first — always studied ahead of the discovered catalogue. |
| `pageName` | string · optional | Figma page to build the landing page onto. Default `"Studio"`. |

Requires the Plumb plugin to be paired — `plumb_studio` writes through the plugin path.

## Returns

```jsonc
{
  "brief": "a premium fintech dashboard",
  "references": [
    { "name": "Mercury", "url": "https://mercury.com" },
    { "name": "Stripe",  "url": "https://stripe.com" }
  ],
  "captured": 4,
  "misses": [],
  "brand": { /* synthesized semantic palette */ },
  "rootId": "412:9",
  "ids": { "hero": "412:15", "cta": "412:88", /* authored el → node id */ },
  "authoredPath": "/tmp/plumb-authored-studio-1720-abc123.json",
  "warnings": [],
  "summary": "built \"Premium Fintech Dashboard\" — 4 reference(s), 214 node(s)",
  "next": "Built. Run plumb_review with { id: rootId, ids, authoredPath } to score built-vs-authored and get the fix list."
}
```

## Example — the prompt→design flow

```txt
"Use plumb_studio to design a premium fintech dashboard. Then screenshot the
 rootId with plumb_screenshot, grade it yourself as a demanding creative
 director, and run plumb_review until the score clears 90 — applying the
 topFixes with plumb_design(mode:"sync") between passes."
```

`plumb_studio` builds the first draft; [`plumb_review`](/tools/plumb_review) closes the loop.

## When the agent should use it

- The one-shot on-ramp for **prompt → Figma**: a brief needs to become a real, composed, on-brand page and you don't want to hand-author the DSL.
- As the first step of the director loop — build with `plumb_studio`, then critique and refine with `plumb_review`.

## Notes

Zero extra model calls: reference research, screenshotting, and palette synthesis are all deterministic and server-side. The creative judgment happens later, in `plumb_review`, where **the agent already driving the MCP server is the director**.

For just the research + palette (a Brand board, not a full page), use [`plumb_brand`](/tools/plumb_brand). For full manual control over sections and copy, author the DSL yourself and build with [`plumb_design`](/tools/plumb_design).
