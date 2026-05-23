# `plumb_fig_outline`

Read a saved `.fig` file from disk and list every screen across every page. The headless / CI counterpart to [`plumb_outline`](/tools/plumb_outline) — works with no Figma desktop, no plugin pairing, no `FIGMA_TOKEN`.

## Inputs

| Field | Type | Notes |
|---|---|---|
| `figPath` | string · required | Absolute path to a `.fig` file on disk. |

## Returns

```jsonc
{
  "source": "fig",
  "file":   { "name": "/abs/path/to/design.fig" },
  "meta":   { "screenCount": 12 },
  "pages":  [
    { "id": "0:1", "name": "Page 1", "frames": [
      { "id": "23:4567", "name": "Home", "w": 1440, "h": 1024, "page": "Page 1" },
      // …
    ] }
  ]
}
```

## When the agent should use it

- Headless contexts (CI builds, design-system audits, scripted exports) where Figma desktop isn't available.
- One-off inspection of a `.fig` you've been emailed or downloaded — no need to import it into Figma first.
- Air-gapped or offline review of design state captured at a specific point in time.

## Saving a `.fig` from Figma

In Figma desktop: **File → Save local copy…** writes a `.fig` to disk. Pass that path to `plumb_fig_outline`.

## What's in the file

`.fig` is Figma's proprietary archive — a ZIP containing a `canvas.fig` binary holding two compressed chunks (a kiwi-schema definition + a kiwi-encoded scene-graph message). Plumb uses [`openfig-core`](https://www.npmjs.com/package/openfig-core) (MIT-licensed, 442 KB, 3 deps) under the hood — Evan Wallace's [Kiwi](https://github.com/evanw/kiwi) format is the actual binary encoding.

## Limitations of the .fig path

- **No live selection.** Use [`plumb_selection`](/tools/plumb_selection) on the plugin path for "what the user has selected right now."
- **No automatic refresh.** A `.fig` is a point-in-time snapshot.
- **No file-local Variables.** What's persisted in the export is read; live editor state isn't.
- **MVP scope.** This tool returns the screen list. The richer PDS (auto-layout → flexbox, deduped tokens, depth-stable handles) returned by `plumb_node` over the plugin/REST paths is on the roadmap for the `.fig` source — for now, [`plumb_fig_node`](/tools/plumb_fig_node) returns basic node metadata.

Use the plugin path when Figma is open — it's faster, more accurate, and exposes the live document. Reach for `.fig` for the headless cases.
