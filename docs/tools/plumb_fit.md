# `plumb_fit`

The self-healing loop. Same diff engine as [`plumb_verify`](/tools/plumb_verify), wrapped in a **0–100 convergence score** plus prioritised fixes — so the agent iterates to a pixel-perfect match instead of running a one-shot check. **The magnet.**

## How it works

Everyone else's design-to-code is fire-and-forget: generate once, hope it's right. Plumb can *measure its own output* — so it closes the loop:

```
build → plumb_fit → "84%, fix these 3 deltas" → fix → plumb_fit → 96% → … → done ✓
```

The agent:

1. Builds the screen, stamping `data-plumb-id="<el>"` on each element (the `el` handles from `plumb_node` / `plumb_query`).
2. Captures box + the `getComputedStyle` subset + text for every tagged element — the same `rendered` payload `plumb_verify` takes.
3. Calls `plumb_fit`. Gets back a `score`, a `done` flag, the highest-leverage `topFixes`, and a printable progress `bar`.
4. If `done` is false, applies the fixes, re-renders, and calls again — until `done` is true.

## The score

```
score = 100 · coverage · fidelity
```

A **product**, not a sum — deliberately. A screen that's pixel-perfect but only half-built reads ~50%, not 100%. You can't fake convergence by building less.

- **coverage** — `importantMatched / importantTotal`: the share of design nodes that carry real visual signal (text, fill, effect, image, radius, icon) that you actually built.
- **fidelity** — per-built-node correctness, severity-weighted (an error counts as fully wrong; a warning is mostly right).

It's monotonic: fixing any delta or building any missing key node always raises the score.

## Inputs

| Field | Type | Notes |
|---|---|---|
| `id` | string · optional | Screen id. |
| `name` | string · optional | Screen name (plugin path). |
| `fileKey` | string · optional | File key (REST path). |
| `url` | string · optional | Paste a full Figma URL — fileKey + node-id auto-extracted. |
| `rendered` | RenderedElement[] · required | What you built (same shape as `plumb_verify`). |
| `iteration` | number · optional | Which pass this is (1, 2, 3…) — sharpens the coaching. |
| `accept` | number · optional | Score at which to stop. Default 98. |
| `tolerances` | object · optional | Override px / colour thresholds. |
| `depth` | number · optional | PDS depth to fetch. Default 12. |

## Returns

```jsonc
{
  "source": "plugin",
  "screen": "Login Card",
  "score": 96.4,
  "done": false,
  "bar": "▰▰▰▰▰▰▰▰▰▱",
  "iteration": 3,
  "matched": 5,
  "importantMatched": 5,
  "importantTotal": 5,
  "errors": 1,
  "warns": 2,
  "topFixes": [
    "0:4 (Button) · fill: expected \"#4F46E5\", got \"#4f46e3\"",
    "0:2 (Title) · text.size: expected 22, got 20"
  ],
  "instruction": "Iteration 3: 96.4% — fix 1 error and 2 warnings below, re-render, and call plumb_fit again.",
  "deltas": [ /* full sorted delta list, as plumb_verify */ ],
  "coverage": { /* … */ }
}
```

`done: true` means the score cleared `accept` and no error-severity deltas remain — stop. See [`plumb_verify`](/tools/plumb_verify#delta-kinds) for the full list of delta kinds and tolerances; `plumb_fit` uses the identical engine.

## Two ways to run the loop

- **In your editor (free).** This MCP tool — Claude Code / Cursor / Windsurf generate, call `plumb_fit`, and self-correct. No API key beyond your editor's; the agent is the generator.
- **Autonomously, from the CLI.** `plumb-mcp fit <figma-url>` extracts the design, generates a self-contained HTML build, renders it headless in your installed Chrome, diffs, and corrects it pass-by-pass until it matches. Needs `FIGMA_TOKEN` + `ANTHROPIC_API_KEY`. See [Get started](/getting-started).
- **In the browser.** The <a href="/play/" target="_self">Playground</a> runs the same loop client-side with your own Anthropic key — paste a Figma URL or pick a demo and watch it converge.

## When the agent should use it

- Building a screen from scratch and you want it *right*, not *close* — let it iterate.
- Any time `plumb_verify` would be your next step anyway: `plumb_fit` is `plumb_verify` plus a target to converge to.

## Notes

Both paths supported (plugin and REST). Verification is **structural**, not visual — no pixel diff. The score and fixes are derived deterministically from the same deltas `plumb_verify` produces.
