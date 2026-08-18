# `plumb_studio_page`

**Step 3 of 3** in the transparent studio flow — repeatable. Composes a full **product page** of a given kind onto its own named Figma page, reusing the session's brand, reference imagery, and component kit.

## How it works

Given a `sessionId` (from [`plumb_studio_start`](/tools/plumb_studio_start), with the kit already built by [`plumb_studio_kit`](/tools/plumb_studio_kit)), composes a real page — **landing / features / pricing / dashboard** — instantiating the session's component library and reusing the reference screenshots already captured in step 1, so nothing gets re-captured.

Call it once per page to build a whole product page by page — e.g. `landing`, then `pricing`, then `dashboard`, each onto its own named Figma page.

Requires the Plumb plugin to be paired — this tool writes through the plugin path.

## Inputs

| Field | Type | Notes |
|---|---|---|
| `sessionId` | string · required | Session id from `plumb_studio_start`. |
| `pageName` | string · required | Figma page to build onto, e.g. `"Landing"`. |
| `kind` | `"landing"` \| `"features"` \| `"pricing"` \| `"dashboard"` · optional | Which page to compose. Default `"landing"`. |

## Returns

```jsonc
{
  "sessionId": "sess_abc123",
  "kind": "landing",
  "rootId": "412:88",
  "ids": { "hero": "412:91", "cta": "412:140" /* authored el → node id */ },
  "authoredPath": "/tmp/plumb-authored-studio-page-1720-abc123.json",
  "warnings": [],
  "summary": "built landing page — 214 node(s)",
  "next": "Screenshot rootId, grade it as director, then plumb_review with { id: rootId, ids, authoredPath, director }."
}
```

## Example — building a multi-page product

```txt
"With sessionId sess_abc123 from plumb_studio_start (and the kit already built),
 call plumb_studio_page for pageName \"Landing\" (kind: landing), then again for
 pageName \"Pricing\" (kind: pricing). Screenshot each rootId and run plumb_review
 until each clears 90."
```

## When the agent should use it

- As the final, repeatable step of the transparent studio flow, once a session has a brand ([`plumb_studio_start`](/tools/plumb_studio_start)) and a component kit ([`plumb_studio_kit`](/tools/plumb_studio_kit)).
- To build more than one product page from the same brand + kit, without re-running reference research or re-synthesizing the palette each time — the one-call [`plumb_studio`](/tools/plumb_studio) only builds a single landing page.

## Notes

Returns `authoredPath` the same way `plumb_studio` does, so you can hand the build straight to [`plumb_review`](/tools/plumb_review) for the critique loop. An unknown or expired `sessionId` fails clearly — call `plumb_studio_start` (and `plumb_studio_kit`) first.
