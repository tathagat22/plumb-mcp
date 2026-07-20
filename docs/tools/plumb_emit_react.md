# `plumb_emit_react`

Deterministic PDS / WebSpec → React (JSX + inline styles) code generator. Pass the raw JSON from a prior `plumb_node`/`plumb_outline`/`plumb_query` call (Figma) **or** a prior `plumb_import_web` call (a live site) — the same emitter handles both, since both build onto the same underlying Semantic Graph.

**Not an LLM call.** Template-based and fully deterministic, mirroring the existing PDS→Figma emit path's own "every conversion happens here, mechanically" design — not `plumb_fit`'s LLM-based HTML generator, which is a deliberately separate, non-deterministic, caller-funded path.

## Inputs

| Field | Type | Notes |
|---|---|---|
| `doc` | object · required | A `PdsDocument` or a `WebSpecDocument` — auto-detected by shape (a `PdsDocument` has `tokens`; a `WebSpecDocument` has `url`). |
| `componentName` | string · optional | Default `"GeneratedComponent"`. |

## Returns

```jsonc
{
  "code": "export default function Hero() {\n  return (\n    <div style={{ width: 1200, height: 400, ... }}>\n      ...\n    </div>\n  );\n}\n",
  "warnings": [
    "Node \"icon-1\" is a vector (icon/illustration) — no vector path is reproduced, rendered as an empty box.",
    "Node \"photo-2\" is an image with no captured src — src left as a placeholder."
  ]
}
```

## What it does and doesn't do

- Every box's `width`/`height` is emitted explicitly, from the measured/designed size — this is **pixel-faithful, not a hand-tuned responsive component**. There's no hug/fill/fixed sizing intent in the graph yet to generate `flex: 1` / `width: auto` from.
- Roles (`nav`/`footer`/`sidebar`) become semantic tags (`<nav>`, `<footer>`, `<aside>`) instead of bare `<div>`s; `hero`/`card` fall back to `<div>` (no HTML5 equivalent).
- Gradients, multi-layer shadows, opacity, backdrop-filter, border radius (including pill/circle), and typography (align/decoration/letter-spacing/line-height) all round-trip into inline styles.
- **Vector nodes (icons, inline SVG) render as an empty box** — no vector path data is reproduced. Check `warnings` for every one.
- **Images with no captured source get an empty `src`** — check `warnings`; this happens when neither `.src`, common lazy-load `data-*` attributes, nor a `background-image: url(...)` resolved to anything.

## When the agent should use it

- A first-pass, structurally-faithful React component from a Figma screen or an imported webpage, to hand-tune from rather than write from scratch.
- Proving out what a design/page actually looks like structurally before committing to a full hand-written implementation.

## Notes

Read-only, does no fetching itself — works entirely from the `doc` you pass in. Always check `warnings` before treating the output as complete; it degrades node-by-node rather than throwing, so a partial or lossy render still returns usable code for everything else.
