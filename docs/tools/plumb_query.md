# `plumb_query`

Query a Figma subtree by pattern instead of dumping the whole tree. The escape hatch for dense screens where `plumb_node` would blow the token budget.

## Inputs

| Field | Type | Notes |
|---|---|---|
| `select` | enum · required | `"skeleton"`, `"buttons"`, `"text"`, `"components"`, or `"role"`. |
| `id` | string · optional | Node/screen id to query within. |
| `name` | string · optional | Screen name (plugin path). |
| `fileKey` | string · optional | File key (REST path). |
| `url` | string · optional | Paste a Figma URL — `fileKey` and `id` auto-extracted. |
| `min`, `max` | number · optional | Font-size filter for `select: "text"`. |
| `componentId` | string · optional | Filter `select: "components"` to one component. |
| `role` | enum · required for `select: "role"` | One of `nav`, `hero`, `footer`, `sidebar`, `card`, `button`. |

## The five patterns

- **`skeleton`** — structure only. Drops `chars`, fills, effects, text refs, vector paths. The agent gets the shape of the screen for roughly 10× fewer tokens, then drills into branches that matter with `plumb_node`.
- **`buttons`** — every node Plumb's normalizer tagged with `pattern: "button"`. Equivalent to `select: "role", role: "button"`; kept for backward compatibility.
- **`text`** — every `TEXT` node, optionally filtered by font-size range. Use `min: 24` to find headings, `max: 14` to find body copy / captions.
- **`components`** — every `INSTANCE` node, optionally filtered to a specific `componentId`. Useful for "find every place this button component is used".
- **`role`** — every node carrying a given semantic role. `nav` / `hero` / `footer` / `sidebar` / `card` are container-level (detected among a screen's top-level sections and repeat-group templates); `button` is the same leaf-level tag `select: "buttons"` reads. Useful for "find the hero" or "find every pricing card" without walking the tree yourself.

## Returns

```jsonc
{
  "scope":  { "id": "101:870", "name": "Settings" },
  "select": "buttons",
  "matches": [
    { "el": "save", "id": "101:921", "type": "instance", "box": { "w": 96, "h": 36 }, "pattern": "button", "component": "btn/primary" },
    // …
  ],
  "tokens": { "color": { … }, "text": { … } },
  "meta":   { "count": 7, "estTokens": 412 },
  "source": "plugin",
  "next":   "Drill into a match with plumb_node({ id: match.id }) for full detail."
}
```

The matches share the same `el` handles as a full `plumb_node` call — so you can verify against them with `plumb_verify` without re-fetching.

## When the agent should use it

- The agent called `plumb_node` and got a "node too large, try lower depth" hint, but the screen is genuinely dense.
- It only needs one slice of the tree: "all the buttons", "every heading", "every component instance".
- Building a high-level mental model before diving in — pull the `skeleton` first, then `plumb_node` the regions worth detail.

## Notes

Operates on a full-depth PDS internally, so the cost on the server side is the same as `plumb_node` at max depth — the win is in the payload returned to the agent.

Mirrors `plumb_node`'s scope resolution exactly: plugin path takes `id` or `name`, REST path takes `fileKey + id` (or a `url`).
