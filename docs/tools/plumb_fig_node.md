# `plumb_fig_node`

Read one node from a saved `.fig` file by its id. The headless counterpart to [`plumb_node`](/tools/plumb_node) — works with no Figma desktop, no plugin pairing, no `FIGMA_TOKEN`.

## Inputs

| Field | Type | Notes |
|---|---|---|
| `figPath` | string · required | Absolute path to a `.fig` file on disk. |
| `id` | string · required | Node id — `sessionID:localID` form. Get one from `plumb_fig_outline`. |

## Returns

```jsonc
{
  "source": "fig",
  "node": {
    "id":          "23:4567",
    "name":        "Home",
    "type":        "FRAME",
    "size":        { "w": 1440, "h": 1024 },
    "stackMode":   "VERTICAL",        // auto-layout direction, or undefined
    "cornerRadius": 12,
    "opacity":     1,
    "fillCount":   1,
    "strokeCount": 0,
    "text":        null               // populated for TEXT nodes
  },
  "next": "This MVP exposes basic metadata. …"
}
```

For `TEXT` nodes the `text` object carries `characters`, `fontSize`, `fontFamily`, and `fontStyle`.

## When the agent should use it

- After `plumb_fig_outline`, to inspect a specific screen by id.
- Quick sanity-check that a `.fig` contains the node you expect.

## MVP scope

This is the minimum useful surface for the `.fig` path. It returns *metadata*, not the full Plumb Design Spec yet — `auto-layout → flexbox`, deduped tokens, recursive children with depth-stable `el` handles are on the roadmap.

For the full PDS today, use [`plumb_node`](/tools/plumb_node) on the plugin or REST path. Use this tool when you need the metadata in headless / CI / offline contexts where the live paths aren't available.
