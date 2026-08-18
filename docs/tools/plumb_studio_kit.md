# `plumb_studio_kit`

**Step 2 of 3** in the transparent studio flow. Builds the reusable **component library** for a session's brand as real Figma component masters, onto its own named page.

## How it works

Takes the `sessionId` from [`plumb_studio_start`](/tools/plumb_studio_start) and builds a set of component masters — **Button, FeatureCard, StatCard, PricingCard** — that inherit the session's palette and type scale, then puts them on show on a named page (default `"Components"`).

Requires the Plumb plugin to be paired — this tool writes through the plugin path.

## Inputs

| Field | Type | Notes |
|---|---|---|
| `sessionId` | string · required | Session id returned by `plumb_studio_start`. |
| `pageName` | string · optional | Figma page for the component library. Default `"Components"`. |

## Returns

```jsonc
{
  "sessionId": "sess_abc123",
  "components": ["Button", "FeatureCard", "StatCard", "PricingCard"],
  "rootId": "412:40",
  "next": "Watch the \"Components\" page. Then call plumb_studio_page(\"sess_abc123\", { pageName, kind }) to compose a product page (landing / features / pricing / dashboard)."
}
```

## Example

```txt
"Call plumb_studio_kit with the sessionId from plumb_studio_start to build the
 component library, then watch the Components page."
```

## When the agent should use it

- After `plumb_studio_start`, whenever the flow needs reusable component masters before composing any product page.
- Skip it only if you're not planning to call `plumb_studio_page` at all (the page composer instantiates this kit).

## Notes

An unknown or expired `sessionId` fails clearly — call `plumb_studio_start` first and pass the `sessionId` it returns. Follow with [`plumb_studio_page`](/tools/plumb_studio_page).
