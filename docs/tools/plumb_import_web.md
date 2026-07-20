# `plumb_import_web`

Import a live webpage's structure and semantics — no Figma connection needed. Drives headless Chrome to walk the page's visible DOM and maps it onto the same Semantic Graph Figma designs use, so the exact same role classifier (`nav`/`hero`/`footer`/`sidebar`) runs on it.

**Not a visual clone tool.** This extracts structure — box sizes, positions, colors, text, layout — as data. It does not screenshot, reproduce, or "copy" a page pixel-for-pixel; pair it with `plumb_emit_react` if you want generated code.

## Inputs

| Field | Type | Notes |
|---|---|---|
| `url` | string · required | The page URL to import. |
| `selector` | string · optional | CSS selector to root the walk at. Omit to walk from `document.body`. |

## Returns

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

Each node carries real CSS values — a resolved hex color, an actual px number — never a Figma-style `$cN` token ref. Fields present depend on the node: `fills`/`effects` for gradients/shadows, `imageSrc` for images, `textAlign`/`textDecoration`/`letterSpacing`/`lineHeightPx` for text, `borderRadius`/`borderColor`/`borderWidth` for styled surfaces.

## What's classified, what isn't

`nav` / `hero` / `footer` / `sidebar` use the exact same conservative heuristics Figma-sourced screens get (structural signals only — box size, position, layout flow; silence over a guess). `card` is **not** detected on imported pages — it depends on repeat-group similarity detection this adapter doesn't build yet.

CSS Grid layouts and complex fixed/sticky-positioned regions currently under-detect (the layout mapper only understands `display:flex`) — the classifier correctly abstains rather than guessing wrong, so a Grid-heavy nav may simply carry no role.

## When the agent should use it

- Understanding an existing site's structure before rebuilding or auditing it.
- Feeding `plumb_audit` (contrast/touch-target checks on a real page) or `plumb_diff` (track a URL's structure over time — import it, then import again later and diff the two results).
- Feeding `plumb_emit_react` to generate a first-pass React component from the captured structure.

## Notes

Read-only in the sense that it doesn't mutate anything, but each call drives a real headless Chrome instance against a live URL — not idempotent if the page's content changes between calls. A hard node cap protects against adversarial or extremely large pages.
