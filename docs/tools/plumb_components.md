# `plumb_components`

List every component definition in the file and every instance usage of each. The design system inventory.

## Inputs

| Field | Type | Notes |
|---|---|---|
| `page` | string · optional | Filter components and instances to one Figma page by name (case-insensitive, substring-friendly). A real token saver on files that hide a 200-variant style guide on one page. |
| `health` | boolean · optional | Also compute a design-system health report over the (page-filtered) list — see below. Default `false`; purely additive to the response when set. |

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

## Design-system health report (`health: true`)

Three cheap, real checks — everything derivable from data Plumb already fetches, no new calls:

```jsonc
{
  // …the usual fields, plus:
  "health": {
    "unusedComponents": [ { "id": "183:9001", "name": "Old Button", "page": "Page 1" } ],
    "possibleDuplicates": [
      { "normalizedName": "button", "components": [
        { "id": "183:100", "name": "Button", "page": "Page 1" },
        { "id": "183:214", "name": "Button copy", "page": "Page 1" }
      ] }
    ],
    "variantOutliers": [
      { "componentId": "183:100", "instanceId": "101:900", "instanceName": "One-off CTA", "overrides": ["Label=Weird one-off", "Icon=true"] }
    ],
    "summary": "1 unused component(s), 1 possible duplicate group(s), 1 one-off variant override(s)."
  }
}
```

- **`unusedComponents`** — `instanceCount === 0`. A component nobody uses.
- **`possibleDuplicates`** — components whose name, normalized (lowercased, "copy"/parenthetical suffixes/trailing digits stripped), collides with another's. A name heuristic, not a structural one — two components that happen to look identical but are named differently won't be caught; true structural duplicate detection would need to fetch and compare every component's full node tree, which this doesn't do.
- **`variantOutliers`** — an instance whose prop-override combination matches no other instance of the same component, among components with **at least 3 instances** (enough for "everyone else does X" to mean something). A proxy for ad-hoc one-off customization rather than an intentional variant.

## When the agent should use it

- Auditing how a design system is used: which components are over-used, which are dead.
- Building a code-side component map.
- Answering "where does `<MyButton>` show up" without grepping.

## Notes

Plugin-path only.

Under Figma's `documentAccess: "dynamic-page"` mode, the synchronous `mainComponent` accessor throws on unloaded pages. Plumb walks the tree, collects every `INSTANCE`, then resolves their main components via `getMainComponentAsync()` in **parallel batches of 64**. This scales to design systems with thousands of instances; a sequential implementation timed out (MCP client's 60 s default) on real files we tested.

For very large files, increase your MCP client's per-call timeout — see [troubleshooting](/troubleshooting). Plumb itself doesn't impose a tighter limit.

A `componentCount` of 0 alongside a non-zero `instanceCount` is normal — it means this file uses instances of **library** components (defined in another file), not local definitions.
