# `plumb_review`

The critique loop for the write direction — the mirror of [`plumb_fit`](/tools/plumb_fit). Blends a structural diff, a design rubric, and **your own vision verdict** into one score + ranked fixes. **The write-side magnet.**

## How it works

Where `plumb_fit` closes the **read** loop (you build HTML, it scores your build against the design), `plumb_review` closes the **write** loop: after `plumb_design` / `plumb_studio` emit a design into Figma, it re-serializes the *built* nodes back to a PDS and grades them on up to three axes at once, then coaches the refine loop:

```
build → screenshot → grade it yourself → plumb_review → "82%, fix these" → sync → plumb_review → 94% → … → done ✓
```

- **STRUCTURE** — built-vs-authored fidelity. The emitted nodes are diffed against the PDS the compiler authored, joined by `ids` (authored `el` → Figma node id). Same engine as [`plumb_verify`](/tools/plumb_verify).
- **DESIGN** — a deterministic six-dimension rubric: hierarchy, spacing rhythm, contrast (WCAG AA), alignment, type-scale, and professional-vs-templated polish. Failing contrast is an error and blocks `done`.
- **DIRECTOR** *(optional)* — **your own** vision grade of the rendered screenshot. There is **no server-side vision call and no API key** — the agent already driving the MCP server already has vision and already has the PNG from `plumb_screenshot`, so it grades the screenshot itself and passes the verdict in via `director`. This catches the visual balance, focal flow, crop, and "designed vs generated" gestalt a deterministic PDS pass can't see.

The loop: `plumb_design` → `plumb_screenshot(rootId)` → grade it yourself → `plumb_review(..., director: {...})` → if not `done`, apply `topFixes` and `plumb_design(mode:"sync")` → review again.

## Inputs

| Field | Type | Notes |
|---|---|---|
| `id` | string · optional | Emitted root node id (`EmitResult.rootId`). |
| `name` | string · optional | Screen name (plugin path). |
| `fileKey` | string · optional | File key (REST path). |
| `url` | string · optional | Paste a full Figma URL — fileKey + node-id auto-extracted. |
| `authored` | object · optional | The authored `PdsDocument` (what the DSL compiled to). Inline alternative to `authoredPath`. |
| `authoredPath` | string · optional | Path to the JSON `PdsDocument` (the `authoredPath` `plumb_design` / `plumb_studio` write). |
| `ids` | record<string,string> · optional | `EmitResult.ids` — authored `el` → Figma node id. **The join key for the structural diff** — pass it or the diff can't line up. |
| `brief` | object · optional | Design intent to grade against: `{ typeSizes?, fonts?, spacingBase?, note? }`. |
| `accept` | number · optional | Blended score at which to stop. Default 90. |
| `iteration` | number · optional | Which refine pass this is (1, 2, 3…) — sharpens the coaching. |
| `tolerances` | object · optional | Override structural thresholds (`px` / `color`, each `{ ok, warn }`). |
| `depth` | number · optional | PDS depth to re-serialize. Default 12. |
| `director` | object · optional | **Your own** vision grade: `{ score: 0–100, verdict?, issues?[] }`. Each issue: `{ dimension, severity, el?, message, fix }`. When present, weights become structure 0.4 / design 0.3 / director 0.3 and a director error blocks `done`. |

Provide the authored design via `authored` (inline) **or** `authoredPath`, and point `id` / `name` / `url` at the emitted root.

## Returns

```jsonc
{
  "source": "plugin",
  "screen": "Premium Fintech Dashboard",
  "score": 88.6,
  "structureScore": 94.1,
  "designScore": 83,
  "directorScore": 86,
  "directorVerdict": "Strong hierarchy, but the hero image crop clips the product.",
  "done": false,
  "bar": "▰▰▰▰▰▰▰▰▱▱",
  "iteration": 2,
  "matched": 40, "importantMatched": 38, "importantTotal": 41,
  "structureErrors": 1, "structureWarns": 3,
  "dimensions": [ /* per-rubric-dimension sub-scores */ ],
  "topFixes": [
    "hero (Hero) · contrast: sub text #8A8A8A on #FFFFFF fails AA",
    "[director/polish] cta · tighten the CTA section rhythm — it reads templated"
  ],
  "instruction": "Iteration 2: 88.6% — fix 1 error below, re-apply mode:\"sync\", and review again.",
  "rubric": { /* overall, dimensions, issues, directorIssues */ },
  "deltas": [ /* full structural delta list, as plumb_verify */ ],
  "coverage": { /* … */ }
}
```

`done: true` means the blended score cleared `accept` and no error-severity issue remains on any active axis — stop. Director-sourced fixes are tagged `[director/<dimension>]`.

## Example — the prompt→design flow

```txt
"plumb_studio designed the page and returned { rootId, ids, authoredPath }.
 Screenshot rootId with plumb_screenshot, look at the PNG, grade it as a
 demanding creative director, and call:
   plumb_review({ id: rootId, ids, authoredPath, director: { score, issues } })
 If not done, apply topFixes and plumb_design(mode:"sync"), then review again
 until done or score ≥ 90."
```

A `plumb_review` response with **no** `director` input echoes the exact grading criteria and output shape at the end of its `instruction`, so the agent knows how to grade the next pass.

## When the agent should use it

- After any write (`plumb_studio` / `plumb_design`) — to confirm the build is both **faithful** (structure) and **good** (design + director), and to get a prioritised fix list.
- As the convergence target of the director loop — iterate `review → sync → review` until `done`.

## Notes

`plumb_review` is read-only and idempotent — it never edits Figma; it grades and coaches. The refine happens when you act on `topFixes` and re-apply via [`plumb_design`](/tools/plumb_design). It shares the exact diff engine and delta kinds as [`plumb_verify`](/tools/plumb_verify).
