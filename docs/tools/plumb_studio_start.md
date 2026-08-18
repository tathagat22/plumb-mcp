# `plumb_studio_start`

**Step 1 of 3** in the transparent studio flow — the same director pass as [`plumb_studio`](/tools/plumb_studio), split into watchable steps across separate named Figma pages instead of one opaque call. Opens a session that `plumb_studio_kit` and `plumb_studio_page` reuse.

## How it works

Given a one-line brief, this step does everything `plumb_studio` does *except* compose the final page:

```
brief → research references → screenshot them live → extract a brand → build a References + Brand board → open a session
```

1. **Researches references** — discovers best-in-class sites for the brief (plus any explicit `references`, always studied first).
2. **Screenshots them live** — renders each in headless Chrome, reused later as gallery/hero imagery by `plumb_studio_page`.
3. **Extracts a brand** — synthesizes a coherent semantic palette + type scale from the captures.
4. **Builds a References + Brand board** — real Figma Variables + text styles, written onto its own page (default `"Brand"`).
5. **Opens a session** — returns a `sessionId` that carries the brand, references, and already-staged screenshots forward, so `plumb_studio_kit`/`plumb_studio_page` never re-capture anything.

Requires the Plumb plugin to be paired — this tool writes through the plugin path.

## Inputs

| Field | Type | Notes |
|---|---|---|
| `brief` | string · required | One-line description, e.g. `"a premium fintech dashboard"`. Drives reference discovery, palette, and copy for later steps. |
| `count` | number · optional | How many reference sites to study + screenshot. Default 4. |
| `references` | string[] · optional | Explicit reference URLs to include first — always studied ahead of the discovered catalogue. |
| `pageName` | string · optional | Figma page for the brand board. Default `"Brand"`. |

## Returns

```jsonc
{
  "sessionId": "sess_abc123",
  "name": "Fintech Dashboard",
  "brand": { /* synthesized semantic palette + type scale */ },
  "references": [{ "name": "Mercury", "url": "https://mercury.com" }],
  "captured": 4,
  "misses": [],
  "foundationsWarnings": [],
  "rootId": "412:9",
  "next": "Watch the \"Brand\" page. Then call plumb_studio_kit(\"sess_abc123\") to build the component library."
}
```

## Example

```txt
"Use plumb_studio_start to direct a brand for a premium fintech dashboard.
 Watch the Brand page, then call plumb_studio_kit with the returned sessionId."
```

## When the agent should use it

- You (or the user) want to **watch each stage build** on its own Figma page instead of getting one finished page back from `plumb_studio`.
- You want to review or adjust the brand before any product page gets composed against it.

## Notes

Follow with [`plumb_studio_kit`](/tools/plumb_studio_kit), then [`plumb_studio_page`](/tools/plumb_studio_page) (repeatable, once per page). For the one-call equivalent, use [`plumb_studio`](/tools/plumb_studio) instead.
