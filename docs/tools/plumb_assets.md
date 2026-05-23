# `plumb_assets`

Export icons (SVG) and images (PNG) to disk. Three modes — recursive, list, surgical.

## Inputs

| Field | Type | Notes |
|---|---|---|
| `id` | string · optional | Screen id to scope the recursive export. |
| `name` | string · optional | Screen name (resolved against the outline). |
| `ids` | string[] · optional | **Surgical mode**: export exactly these node ids. |
| `list` | boolean · optional | **List mode**: return the manifest only, no files written. |

## Modes

### Default (recursive)

Pass `id` or `name`. Plumb walks the screen, finds every exportable node (icons, image fills, vector groups), exports them, and writes them to `./plumb-assets/<screen-name>/`.

### List (`list: true`)

Same as default, but **no files are written**. Returns the manifest (id, name, format, parentId per candidate). Use this first on big screens to plan a surgical pull.

### Surgical (`ids: [...]`)

Export exactly these node ids — one file each, no recursion. Preferred once the agent knows what it needs (typically after a `list: true` pass).

## Returns

```jsonc
{
  "source": "plugin",
  "dir":    "./plumb-assets/employe-list",
  "count":  106,
  "assets": [
    { "id": "…", "name": "search-normal", "format": "SVG",
      "path": "./plumb-assets/employe-list/search-normal.svg", "bytes": 475 },
    // …
  ],
  "next":   "Use these file paths when building. …"
}
```

## When the agent should use it

- When implementing a screen — exports the icons / images it needs to reference by relative path.
- When building a documentation site or sticker sheet — pull every asset from a design-system file.

## Notes

Capped at **300 assets per call** (`MAX_ASSETS`). Use `list: true` first on huge screens, then surgical mode for the subset that matters.

Bytes ship via loopback HTTP — never base64 over WebSocket. The plugin waits for an upload-ack from the UI iframe before exporting the next asset, which keeps Figma's IPC from buffering and redelivering messages on large batches. Live numbers: **106 assets in ~600 ms** on a real production design system.

The classifier:

- Nodes with explicit `exportSettings` → exported in the format they specify.
- `GROUP` nodes containing vectors and no text → SVG (preserves multi-layer icon groups).
- Containers whose subtrees are vector-only and bounded → SVG (the "icon subtree" heuristic).
- Standalone `VECTOR / BOOLEAN_OPERATION / STAR / LINE / POLYGON` → SVG, but only if no ancestor was already exported.
- Anything with an image fill → PNG.
