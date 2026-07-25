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

- Every box's `width`/`height` is emitted as an explicit pixel value by default — **pixel-faithful**. When a node carries Figma's own hug/fill/fixed sizing intent (`grow`/`selfAlign`/`sizing`) AND its parent is a flex container, the matching axis emits `flexGrow`/`alignSelf` instead and omits that axis's pixel size, so the component actually reflows. Figma-sourced graphs carry this signal today; the HTML adapter doesn't infer it from CSS yet, so web-imported nodes stay pixel-faithful.
- Roles (`nav`/`footer`/`sidebar`) become semantic tags (`<nav>`, `<footer>`, `<aside>`) instead of bare `<div>`s; `hero`/`card` fall back to `<div>` (no HTML5 equivalent).
- Gradients, multi-layer shadows, opacity, backdrop-filter, border radius (including pill/circle), and typography (align/decoration/case/letter-spacing/line-height) all round-trip into inline styles.
- A web-sourced `display:grid` container emits real `display: "grid"` + `gridTemplateColumns`/`gridTemplateRows`/`columnGap`/`rowGap`, not flex. Figma-sourced layouts are always flex (Figma has no native Grid concept).
- **Vector nodes (icons, logos) render real content, not a placeholder.** A Figma-sourced icon under the inline-path budget (≤600 chars) emits a real `<svg><path d="…" /></svg>`; an HTML-sourced inline `<svg>` (≤20,000 chars of markup) is embedded verbatim via `dangerouslySetInnerHTML`. Only an icon over budget, or one this capture couldn't reach, falls back to an empty box — check `warnings` for those.
- **Images with no captured source get an empty `src`** — check `warnings`; this happens when neither `.src`, common lazy-load `data-*` attributes, nor a `background-image: url(...)` resolved to anything.

## When the agent should use it

- A first-pass, structurally-faithful React component from a Figma screen or an imported webpage, to hand-tune from rather than write from scratch.
- Proving out what a design/page actually looks like structurally before committing to a full hand-written implementation.

## Notes

Read-only, does no fetching itself — works entirely from the `doc` you pass in. Always check `warnings` before treating the output as complete; it degrades node-by-node rather than throwing, so a partial or lossy render still returns usable code for everything else.
