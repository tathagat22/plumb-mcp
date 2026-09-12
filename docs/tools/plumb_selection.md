# `plumb_selection`

The user's *live* Figma selection. Whatever they currently have selected in the Figma app.

## Inputs

None.

## Returns

```jsonc
{
  "fileName": "Design system",
  "pageName": "Page 1",
  "nodeName": "Settings → Profile",
  "doc":      { /* raw Figma node, same shape plumb_node consumes */ }
}
```

If nothing is selected, `doc` is `null`.

## When the agent should use it

- When the user says "this screen" or "what I have selected" — disambiguate by reading the live selection.
- For quick experiments where the user is iterating in Figma and wants the agent to follow along.

## Notes

Plugin-path only — REST has no concept of "current selection."

The plugin only reports *that* the selection changed (id and name) as the
user clicks around Figma — it does not walk and serialize the selected
subtree until `plumb_selection` is actually called. That pull is cached: a
second call on a selection that hasn't changed, and hasn't been edited since,
returns instantly instead of re-fetching. Selecting something, including
something large, never blocks the Figma UI on its own — the cost of reading
it is only paid when this tool is called.
