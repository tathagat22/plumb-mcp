# `plumb_import_web`

Import a live webpage's structure and semantics — no Figma connection needed. Drives headless Chrome to walk the page's visible DOM and maps it onto the same Semantic Graph Figma designs use, so the exact same role classifier (`nav`/`hero`/`footer`/`sidebar`) runs on it.

**Not a visual clone tool.** This extracts structure — box sizes, positions, colors, text, layout — as data. It does not screenshot, reproduce, or "copy" a page pixel-for-pixel; pair it with `plumb_emit_react` if you want generated code.

## Inputs

| Field | Type | Notes |
|---|---|---|
| `url` | string · required | The page URL to import. |
| `selector` | string · optional | CSS selector to root the walk at. Omit to walk from `document.body`. |
| `viewports` | `true` \| `{label, width, height}[]` · optional | Capture the SAME page at multiple sizes in one call. `true` uses the default set (mobile 390×844, tablet 768×1024, desktop 1440×900). Omit for a single desktop capture (today's default, unchanged). |

## Returns (single capture — no `viewports`)

```jsonc
{
  "url": "https://example.com",
  "root": "0.0",
  "nodes": {
    "0.0": {
      "id": "0.0", "kind": "container", "box": { "w": 1200, "h": 2000 },
      "role": "nav", "layout": { "flow": "row", "pad": [0,0,0,0] },
      "children": ["0.0.0", "0.0.1"]
    },
    "0.0.0": {
      "id": "0.0.0", "kind": "text", "box": { "w": 120, "h": 24 },
      "chars": "Ship faster", "textPx": 48, "fillColor": "#000000"
    }
    // …
  },
  "meta": { "nodeCount": 214 },
  "next": "Nodes with a `role`… card isn't detected on imported pages yet…"
}
```

Each node carries real CSS values — a resolved hex color, an actual px number — never a Figma-style `$cN` token ref. Fields present depend on the node: `fills`/`effects` for gradients/shadows, `imageSrc` for images, `svgMarkup` for inline `<svg>` icons/logos (verbatim markup, ≤20,000 chars — feeds `plumb_emit_react`'s real `<svg>`/`dangerouslySetInnerHTML` output instead of an empty box), `textAlign`/`textDecoration`/`textCase`/`fontFamily`/`letterSpacing`/`lineHeightPx` for text, `borderRadius`/`borderColor`/`borderWidth` for styled surfaces.

`fontFamily` is the primary font (first entry of the computed fallback stack, quotes stripped) — a generic keyword or a bare system-font stack means the page never set a real family, so it's omitted. The document itself carries a top-level `fontLinks: string[]` — a `<link>`-equivalent stylesheet URL for every distinct captured family that matches a known Google Fonts family (present even in multi-viewport mode, per viewport). Without loading these, generated code with the right `fontFamily` value still silently renders in a fallback font.

## Returns (`viewports` passed)

```jsonc
{
  "url": "https://example.com",
  "viewports": {
    "mobile": { "root": "0.0", "nodes": { /* … */ }, "meta": { "nodeCount": 180 }, "next": "…" },
    "desktop": { "root": "0.0", "nodes": { /* … */ }, "meta": { "nodeCount": 214 }, "next": "…" }
  }
}
```

Each key is a full `WebSpecDocument`, same shape as the single-capture return — or `{ "error": "…", "nextAction": "…" }` if that one size captured no visible content (selector matched nothing at that width, for instance). One browser is reused across all sizes (a live CDP viewport resize, not N separate Chrome launches), and the page is freshly navigated per size so lazy-load/hydration/responsive `srcset` behavior is accurate at each one.

## What's classified, what isn't

`nav` / `hero` / `footer` / `sidebar` / `card` all use the exact same conservative heuristics Figma-sourced screens get (structural signals only — box size, position, layout flow, repeat-group similarity; silence over a guess). `card` detection runs a structural-similarity pass over each container's direct children (same kind, same child-shape, similar size, ≥3 of them) to find repeat groups — the HTML-adapter analog of Figma's plugin-side repeat-group detection.

`display:grid` containers map to a grid-shaped `layout` (`flow: "grid"`, `columns`/`rows` as the browser's resolved px track sizes, `gap`/`gapCross` for column-gap/row-gap) — `plumb_emit_react` renders these as real `display: grid` output, not flex. Complex fixed/sticky-positioned regions still currently under-detect for role classification (nav/hero/footer/sidebar) — the classifier correctly abstains rather than guessing wrong.

## When the agent should use it

- Understanding an existing site's structure before rebuilding or auditing it.
- Feeding `plumb_audit` (contrast/touch-target checks on a real page) or `plumb_diff` (track a URL's structure over time — import it, then import again later and diff the two results).
- Feeding `plumb_emit_react` to generate a first-pass React component from the captured structure.

## Notes

Read-only in the sense that it doesn't mutate anything, but each call drives a real headless Chrome instance against a live URL — not idempotent if the page's content changes between calls. A hard node cap protects against adversarial or extremely large pages.
