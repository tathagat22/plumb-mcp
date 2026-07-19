# `plumb_diff`

Semantic diff between two PDS snapshots of the same screen — narrated deltas instead of a JSON diff. Touches neither the plugin nor REST path itself; it only compares two `PdsDocument`s you already have.

## Inputs

| Field | Type | Notes |
|---|---|---|
| `before` | object · required | A full `PdsDocument`, exactly as returned by `plumb_node` / `plumb_outline` / `plumb_query`. |
| `after` | object · required | Same shape, taken after the change you want to diff. |

Call `plumb_node` (or `plumb_outline`/`plumb_query`) once before a design change and once after, then pass both raw responses here unmodified.

## Returns

```jsonc
{
  "added":   [ { "nodeId": "card1", "role": "card", "kind": "container", "box": { "w": 300, "h": 200 }, "note": "a new card was added" } ],
  "removed": [],
  "renamed": [
    { "beforeId": "hero", "afterId": "hero-section", "role": "hero", "changes": [], "note": "the hero was renamed (id \"hero\" → \"hero-section\")" }
  ],
  "changed": [
    { "nodeId": "footer", "role": "footer", "changes": ["moved"], "before": { "box": { "w": 1200, "h": 120 }, "pos": { "x": 0, "y": 1400 } }, "after": { "box": { "w": 1200, "h": 120 }, "pos": { "x": 0, "y": 1520 } }, "note": "the footer moved from (0, 1400) to (0, 1520)" }
  ],
  "unchangedCount": 41,
  "summary": "1 added, 1 renamed, 1 changed (41 unchanged)."
}
```

Narration uses the same role labels `pattern` already carries (nav/hero/footer/sidebar/card/button) when a node has one — "the hero moved" instead of "el btn-3 moved 40px". Nodes without a detected role fall back to their raw type.

## How matching works

- **Primary: node id.** Plumb's `el` handles are designed to be stable across edits, so most comparisons are a straight id match.
- **Rename fallback: shape.** A node id that only exists on one side is a rename candidate — paired with a same-shape (`kind` + exact `box.w`×`box.h`) candidate on the other side, but **only when exactly one candidate matches**. Ambiguous collisions (two same-shaped candidates) are left as separate `added`/`removed` entries rather than guessed.
- **"Restyled" is coarse** — it compares `kind`, layout flow, and whether the node reads as a styled surface. It does not diff exact colors or paint stacks yet.

## When the agent should use it

- "Did my last edit in Figma break anything downstream?" — snapshot before, make the edit, snapshot after, diff.
- Summarizing a design review: "what changed since the last time I extracted this screen".
- Driving a re-verify: a `changed` entry's `nodeId` is a direct `plumb_node({ id })` target if you need full detail on what moved.

## Notes

Read-only, does no Figma fetching itself — if the shapes you pass don't look like a `PdsDocument` (missing `root`/`nodes`), it fails fast with a clear next action rather than guessing.
