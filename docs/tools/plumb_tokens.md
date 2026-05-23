# `plumb_tokens`

The file's design-token table, on its own. Colours, type styles, radii, shadows — deduped, referenced.

## Inputs

| Field | Type | Notes |
|---|---|---|
| `fileKey` | string · optional | REST path. Omit when plugin is paired. |

## Returns

```jsonc
{
  "color":  { "$c0": "#0c8ce9", "$c1": "#ffffff", … },
  "text":   { "$t0": "600 16px/24 Inter", … },
  "radius": { "$r0": 8, "$r1": 12, … },
  "shadow": { "$s0": "0 1 2 rgba(0,0,0,.08)", … },
  "meta":   { "source": "plugin" }
}
```

## When the agent should use it

- When building a design-system file (Tailwind config, CSS variables, theme constants) directly from Figma.
- When asked which colour / radius / type style is the canonical one.
- Before generating multiple screens — caches the agent's mental model of the file's token vocabulary.

## Notes

These are the exact same tokens that appear inside `plumb_node` PDS responses as `$c…` / `$t…` / `$r…` / `$s…` references. The agent can fetch them separately if it wants the table without a screen.

On the plugin path, this surfaces all of Figma Variables, even on Free plans. The REST Variables endpoint is Enterprise-only — REST users get the older Local Styles only.
