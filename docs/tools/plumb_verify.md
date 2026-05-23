# `plumb_verify`

Diff what you built against the design. Structured deltas, deterministic, no pixel diff. **The closer.**

## How it works

After the agent renders a screen in code, it walks the DOM and for every element tagged `data-plumb-id="<el>"` (where `el` comes from a prior `plumb_node` call), it collects:

- **box** — `getBoundingClientRect()` → `{ x, y, w, h }`
- **styles** — a subset of `getComputedStyle`: background colour, text colour, font family / size / weight / line-height, padding (4 sides), gap, flex direction, justify / align, border radius / colour / width, opacity
- **text** — `textContent` for text nodes

It assembles a `rendered` payload and calls `plumb_verify`. The tool re-fetches the live PDS, joins by `el`, runs every comparison with tolerances, returns a sorted list of structured deltas.

## Inputs

| Field | Type | Notes |
|---|---|---|
| `id` | string · optional | Screen id (preferred). |
| `name` | string · optional | Screen name (plugin path). |
| `fileKey` | string · optional | File key (REST path). |
| `rendered` | RenderedElement[] · required | What the agent built. |
| `tolerances` | object · optional | Override default thresholds for px / colour. |
| `depth` | number · optional | PDS depth to fetch. Default 12. |

Each `RenderedElement`:

```ts
{
  el: string;                            // matches the PDS handle
  box: { x: number; y: number; w: number; h: number };
  text?: string;                         // for TEXT nodes
  styles?: Record<string, string>;       // the getComputedStyle subset
}
```

## Returns

```jsonc
{
  "source": "plugin",
  "screen": "Settings → Profile",
  "matched": 42,
  "rendered": 43,
  "unmatched": 1,
  "ok": false,
  "deltas": [
    { "el": "cta",    "name": "Save", "kind": "fill",
      "expected": "$cBrand", "actual": "#0a6dc2",
      "diff": 11, "severity": "error" },
    { "el": "title",  "name": "Profile", "kind": "size.w",
      "expected": 528, "actual": 530, "diff": 2, "severity": "warn" },
    { "el": "ghost",  "name": "ghost", "kind": "missing-in-pds",
      "expected": null, "actual": "ghost", "severity": "warn" }
  ]
}
```

`ok: true` means no errors. Warns are differences within tolerance you might have meant.

## Delta kinds

| Kind | What it compares |
|---|---|
| `size.w`, `size.h` | Box width/height |
| `layout.flow` | Flex direction |
| `layout.gap` | Auto-layout gap → CSS `gap` |
| `pad.{top,right,bottom,left}` | Auto-layout padding → CSS padding |
| `layout.justify`, `layout.align` | `justifyContent` / `alignItems` |
| `fill` | Non-text background colour |
| `text.color` | Text node colour |
| `text.chars` | Text content |
| `text.size`, `text.weight`, `text.lh`, `text.family` | Type style |
| `radius` | Border radius |
| `stroke`, `stroke.width` | Border colour and width |
| `opacity` | Element opacity |
| `missing-in-pds` | Element you rendered that doesn't exist in the design |

## Default tolerances

- Pixels: ok ≤ 1px, warn ≤ 3px, error > 3px
- Colour: ok ≤ ΔE 6, warn ≤ ΔE 24, error > 24
- Text size: ok ≤ 0.5px, warn ≤ 1.5px
- Text weight: warn if off by ≤ 100, error otherwise
- Line height ratio: warn if off by > 0.05, error if > 0.15
- Opacity: warn if off by > 0.05, error if > 0.15

Override per call with `tolerances`.

## When the agent should use it

- After implementing a screen — confirm pixel-accuracy before reporting back.
- Iteratively while debugging a layout that doesn't quite match.
- In code-review / CI — generate a verify report from a Playwright snapshot.

## Notes

Both paths supported (plugin and REST).

Verification is **structural**, not visual — no pixel diff, no machine-vision. The agent only has to expose `data-plumb-id` on rendered elements; the rest is deterministic.

Up to **150 deltas** per call (`MAX_DELTAS`). Truncation is flagged via `truncated: true`.
