# `plumb_screenshot`

Render any node to PNG or JPG. Full-fidelity, scale-controlled.

## Inputs

| Field | Type | Notes |
|---|---|---|
| `id` | string · optional | Node id. Preferred when known. |
| `name` | string · optional | Looked up against the outline. |
| `scale` | number · optional | Export scale (1, 2, 4…). Default 2. |
| `format` | `"PNG"` \| `"JPG"` · optional | Default `"PNG"`. |

## Returns

```jsonc
{
  "source":   "plugin",
  "path":     "./plumb-screenshots/employe-list.png",
  "format":   "PNG",
  "scale":    4,
  "bytes":    1015020,
  "nodeName": "Employe List"
}
```

## When the agent should use it

- When the user wants a high-res image of a screen (PR descriptions, design docs, communication).
- When pixel-perfect-ish visual comparison is more useful than a structural diff (rarely — prefer `plumb_verify` for code-vs-design checks).
- For UI testing fixtures.

## Notes

Plugin-path only.

Bytes ride the same loopback HTTP channel as `plumb_assets`. The WebSocket reply is just metadata; the file is already on disk when the call returns.

Default location: `./plumb-screenshots/`. Override with `PLUMB_SCREENSHOTS_DIR`.
