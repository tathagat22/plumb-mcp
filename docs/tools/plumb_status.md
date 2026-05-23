# `plumb_status`

Self-description, key legend, connection state. **Call first** in any new session — it tells the agent what's available and how to invoke the other tools.

## Inputs

None.

## Returns

```jsonc
{
  "plugin": { "paired": true, "version": "0.0.1" },
  "rest":   { "tokenPresent": true },
  "tools":  [ /* names and one-line summaries */ ],
  "legend": { /* the key glossary — el, fill, radius shorthand, etc. */ }
}
```

## When the agent should use it

- Once at the start of a session, to discover the tool surface.
- After a long pause, to verify the plugin is still paired.
- When unsure which path (plugin vs REST) is currently usable.

## Notes

Pure metadata — no Figma access, no file reads. Cheap and idempotent.
