# `plumb_components`

List every component definition in the file and every instance usage of each. The design system inventory.

## Inputs

None.

## Returns

```jsonc
{
  "source": "plugin",
  "componentCount": 111,
  "instanceCount":  14608,
  "components": [
    { "id": "183:27941", "name": "vuesax/linear/building",
      "page": "Page 1", "w": 30, "h": 30, "instanceCount": 28 },
    // …
  ],
  "instances": [
    { "id": "101:870", "name": "Employe List", "componentId": "183:…",
      "page": "Page 1" },
    // …
  ],
  "next": "Each instance has a componentId — match it to a definition. …"
}
```

## When the agent should use it

- Auditing how a design system is used: which components are over-used, which are dead.
- Building a code-side component map.
- Answering "where does `<MyButton>` show up" without grepping.

## Notes

Plugin-path only.

Under Figma's `documentAccess: "dynamic-page"` mode, the synchronous `mainComponent` accessor throws on unloaded pages. Plumb walks the tree, collects every `INSTANCE`, then resolves their main components via `getMainComponentAsync()` in **parallel batches of 64**. This scales to design systems with thousands of instances; a sequential implementation timed out (MCP client's 60 s default) on real files we tested.

For very large files, increase your MCP client's per-call timeout — see [troubleshooting](/troubleshooting). Plumb itself doesn't impose a tighter limit.

A `componentCount` of 0 alongside a non-zero `instanceCount` is normal — it means this file uses instances of **library** components (defined in another file), not local definitions.
