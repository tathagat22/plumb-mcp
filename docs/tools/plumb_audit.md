# `plumb_audit`

Heuristic accessibility checks over a PDS snapshot. A problem-finder, not a certified WCAG audit — it reports failures only; a clean result means the checks it runs found nothing, not that the screen is fully accessible.

## Inputs

| Field | Type | Notes |
|---|---|---|
| `doc` | object · required | A full `PdsDocument`, exactly as returned by `plumb_node` / `plumb_outline` / `plumb_query`. |

## What it checks today

- **Contrast** — walks the tree carrying the nearest ancestor's resolved solid fill color down as "the background behind this node." Text nodes with both a resolved own color and a resolved ancestor background are checked against WCAG AA (4.5:1 normal text, 3.0:1 for text ≥24px). Only failures are reported.
- **Touch target** — `pattern: "button"` nodes under the 44×44px WCAG 2.5.5/2.5.8 AA minimum tap size.

**Not built yet** (tracked, not silently skipped): heading-order sanity and a missing-alt-text signal. Both need infrastructure this version doesn't have — heading-order needs a dedicated `heading` role nothing produces today, and missing-alt deserves its own small addition rather than being folded in.

## Returns

```jsonc
{
  "summary": "1 contrast issue(s), 1 touch-target issue(s).",
  "findings": [
    {
      "category": "contrast",
      "nodeId": "caption",
      "detail": { "kind": "contrast", "ratio": 2.4, "level": "fail", "foreground": "#999999", "background": "#888888", "isLargeText": false },
      "note": "text on node \"caption\" has a 2.4:1 contrast ratio against its background (#999999 on #888888) — below the WCAG AA threshold"
    },
    {
      "category": "touchTarget",
      "nodeId": "icon-btn",
      "detail": { "kind": "touchTarget", "box": { "w": 24, "h": 24 }, "minRequired": 44 },
      "note": "node \"icon-btn\" is 24×24px — below the 44px minimum touch-target size"
    }
  ],
  "evidence": [
    { "nodeId": "caption", "note": "text on node \"caption\" has a 2.4:1 contrast ratio…" },
    { "nodeId": "icon-btn", "note": "node \"icon-btn\" is 24×24px…" }
  ]
}
```

A clean run returns `findings: []` and a `summary` that says so explicitly (it also notes the checks it *doesn't* run, so an empty result doesn't read as "fully accessible").

## When the agent should use it

- Before shipping a screen built from Plumb — catch low-contrast text and undersized tap targets before code review does.
- Alongside `plumb_verify`/`plumb_fit`: verify checks the build matches the design; `plumb_audit` checks the design itself for accessibility issues, independent of implementation.

## Notes

Read-only, does no Figma fetching itself. Contrast math follows the W3C relative-luminance/contrast-ratio formulas exactly (verified against the reference black-on-white = 21:1 value); alpha on a fill is parsed but not alpha-composited against what's behind it — a known simplification, not a silent one.
