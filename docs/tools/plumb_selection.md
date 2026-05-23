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

Updates push automatically when the user changes selection in Figma — the bridge tracks it without polling. Calling `plumb_selection` always returns the most recent snapshot.
