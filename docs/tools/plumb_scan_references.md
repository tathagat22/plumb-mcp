# `plumb_scan_references`

Scan several live reference URLs and extract a per-role **style digest** — concrete `nav`/`hero`/`footer`/`card` exemplars (box size, layout, colour, type size/family, alignment) from whichever references actually have that section. Streams live progress to [Plumb Studio](/tools/plumb_studio) as each reference is scanned.

**Not a build tool.** This scans and reports; it doesn't compose or apply anything to Figma. Feed the result into a `plumb_design` DSL or a `plumb_studio` brief yourself.

**Not a palette tool either.** [`plumb_brand`](/tools/plumb_brand) already extracts a synthesized colour palette from references — this is the structural counterpart: what shape do their sections actually take, not what colours do they use.

## Inputs

| Field | Type | Notes |
|---|---|---|
| `references` | string[] · required | Reference URLs to scan live, 1–8. |

## Returns

```jsonc
{
  "references": ["https://linear.app", "https://stripe.com", "https://mercury.com"],
  "patterns": {
    "nav": [
      { "url": "https://linear.app", "box": { "w": 1280, "h": 64 }, "layout": { "flow": "row", "pad": [0,24,0,24] }, "textSizes": [14], "fontFamily": "Inter" }
    ],
    "hero": [
      { "url": "https://linear.app", "box": { "w": 1280, "h": 560 }, "fillColor": "#08090a", "textSizes": [56, 20], "textAlign": "center" }
    ],
    "footer": [ /* … */ ],
    "card": [ /* … */ ]
  },
  "misses": [{ "url": "https://example.com/unreachable", "error": "…" }],
  "next": "Read `patterns.<role>` for concrete exemplars…"
}
```

Each exemplar carries whatever the source page actually had — every field is optional and simply absent when that reference's section didn't set it. `textSizes` is every distinct text size found within the section (up to 3 levels down), largest first — a hero's `[56, 20]` reads as "a 56px headline over 20px body copy," not just one number. A role with zero exemplars means none of the references had a confidently-classified section of that kind (the classifier abstains rather than guessing — same discipline as everywhere else in Plumb).

## When the agent should use it

- **Before** `plumb_studio` or `plumb_design`, when you want the generated sections to actually resemble the references structurally — typical hero height and layout, card-grid density, nav style — not just share their colour palette.
- Comparing how several competitors structure the same kind of section (e.g. pricing-page card grids) before designing your own.

## Notes

Reuses the exact same structural pipeline `plumb_import_web` and its role classifier (`nav`/`hero`/`footer`/`sidebar`/`card`) run on — one page per reference, one desktop-viewport capture each (pass `references` one at a time through `plumb_import_web` with `viewports` if you need responsive exemplars too). Each reference is scanned independently; one failing URL is recorded in `misses` and does not abort the others.
