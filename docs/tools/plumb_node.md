# `plumb_node`

Extract one screen as a compact Plumb Design Spec (PDS). The workhorse tool.

## Inputs

| Field | Type | Notes |
|---|---|---|
| `id` | string · optional | Figma node id (e.g. `"101:870"`). Preferred when you have it. |
| `name` | string · optional | Looked up against the live outline. Returns matches if duplicates. |
| `fileKey` | string · optional | REST path. Omit when plugin is paired. |
| `depth` | number · optional | How deep to recurse. Default: auto-fit to a token budget. |
| `maxTokens` | number · optional | Soft cap; depth is reduced to fit. |
| `notes` | boolean · optional | Include human-readable notes per node (auto-layout hints, etc.). |
| `collapseRoles` | string[] · optional | Semantic-aware compression — collapse every node whose detected role is in this list (`nav`/`hero`/`footer`/`sidebar`/`card`/`button`) to a one-line `summary` instead of its full subtree. See below. |

## Returns

A PDS:

```jsonc
{
  "tokens": {
    "color":  { "$c0": "#0c8ce9", … },
    "text":   { "$t0": "600 16px/24 Inter", … },
    "radius": { "$r0": 8, … },
    "shadow": { "$s0": "0 1 2 rgba(0,0,0,.08)", … }
  },
  "nodes": {
    "screen": {
      "el": "screen", "id": "101:870", "name": "Employe List", "type": "frame",
      "box": { "w": 1322, "h": 735 },
      "layout": { "flow": "col", "gap": 16, "pad": [16,24,16,24], "justify": "flex-start", "align": "stretch" },
      "fill": "$c0",
      "children": ["header", "tabs", "table"]
    },
    "header": { /* … */ },
    // …
  },
  "meta": { "nodeCount": 31, "estTokens": 1708, "depthUsed": 2 }
}
```

## When the agent should use it

- Whenever it needs the structure / layout / styling of a specific screen.
- Iteratively: start with `depth: 2` for a high-level view, drill in with another call on a specific child `id` when it needs more.

## Notes

`el` handles are stable across depths — you can fetch the same screen at depth 2 and depth 6 and the elements that overlap will have the same handle. This is what makes `plumb_verify` work.

Nodes truncated at the depth boundary carry a `more: N` field — the agent can drill in with another `plumb_node` call.

`maxTokens` defaults to a comfortable budget for AI agent context windows. Override only if you've measured.

### `collapseRoles` — semantic-aware compression

Pass `collapseRoles: ["nav", "footer"]` to skip boilerplate chrome while keeping the rest of the screen in full:

```jsonc
"footer": {
  "el": "footer", "type": "frame", "box": { "w": 1200, "h": 120 },
  "pattern": "footer",
  "more": 6,
  "summary": "footer — 1200×120px, 6 children (text \"© 2026\", text \"Privacy\", text \"Terms\", …)"
}
```

Same contract as depth truncation — call `plumb_node({ id: "footer-node-id" })` to expand it if you decide you need it after all. `summary` is generated deterministically from box size, child count, and up to 3 child descriptors; nothing is fabricated. This is opt-in on purpose — Plumb never silently decides you don't need a section's actual content.
