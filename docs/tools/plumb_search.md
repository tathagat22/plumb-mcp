# `plumb_search`

Find nodes by name and/or type. Plumb's grep.

## Inputs

| Field | Type | Notes |
|---|---|---|
| `query` | string · optional | Case-insensitive substring match against node names. |
| `type` | string · optional | Figma node type: `"INSTANCE"`, `"COMPONENT"`, `"TEXT"`, `"FRAME"`, etc. |

At least one of `query` / `type` must be set.

## Returns

```jsonc
{
  "source":  "plugin",
  "count":   50,
  "matches": [
    { "id": "…", "name": "Top Navigation bar", "type": "INSTANCE",
      "page": "Page 1", "w": 1421, "h": 54, "parentName": "Employe List" },
    // …
  ]
}
```

## When the agent should use it

- "Where is `<text>` used in the file?"
- "List every instance of `<Button>`."
- "Show me all the text nodes that read 'TODO' so we know what's unfinished."

## Notes

Plugin-path only.

Capped at **50 matches per call**. If the search hits the cap, narrow with a more specific `query` or `type`.

`plumb_search` does *not* descend into `INSTANCE` children — instances are component mirrors, so descending floods the results with virtualised duplicates. To find instances **inside** instances, use `plumb_components` (which already enumerates every instance) or fetch one specific instance with `plumb_node`.
