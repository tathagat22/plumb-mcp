# `plumb_outline`

Every screen in the current Figma file. The agent's map.

## Inputs

| Field | Type | Notes |
|---|---|---|
| `fileKey` | string · optional | REST path. Omit when plugin is paired. |

## Returns

```jsonc
{
  "source": "plugin",        // or "rest"
  "file":   { "name": "Design system" },
  "meta":   { "screenCount": 665 },
  "pages":  [
    { "id": "0:1", "name": "Page 1", "frames": [
      { "id": "101:870", "name": "Employe List", "w": 1322, "h": 735 },
      // …
    ] }
  ]
}
```

The plugin path streams **every** top-level frame across every page. No selection required.

## When the agent should use it

- Right after `plumb_status`, to find target screens by name or id.
- When the user asks anything spatial about the file ("how many onboarding screens are there", "which page is the dashboard on").
- Before `plumb_node` if it doesn't have the id.

## Notes

`name` collisions are common in real files (multiple "Employe List" frames). The agent disambiguates by `id` or by surrounding context.
