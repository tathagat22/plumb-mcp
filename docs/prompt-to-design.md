---
title: Prompt to design — generate a Figma design with the AI director
description: Turn a one-line prompt into a full, on-brand Figma design. Plumb is a prompt-to-Figma AI design generator that researches live reference sites, extracts a brand, composes a whole page, then critiques its own render and iterates — no extra API key. Text to Figma, AI UI/UX designer, MCP design generation.
head:
  - - meta
    - name: keywords
      content: prompt to design, prompt to figma, text to figma, AI design generator, generate figma designs, AI UI/UX designer, AI design director, AI design agent, MCP design generation, figma mcp, ai that designs ui in figma
---

# Prompt to design — the AI design director

Plumb goes both ways. The [figma → code](/getting-started) direction extracts a screen as a compact spec and verifies your build against it. This page is the other direction: **prompt → design.**

Give Plumb a one-line brief — *"a premium fintech dashboard"* — and it turns into an **AI design director** working live in your Figma file. It researches best-in-class reference sites and screenshots them onto your canvas, extracts a coherent brand from their computed CSS, composes a full page from real Figma nodes, then critiques its own render and iterates until the design clears the bar.

Two things make this different from a one-shot text-to-Figma mockup:

- **Every step is visible on your canvas.** References land on a page, the brand board is real Figma tokens, the composed page is real auto-layout frames — nothing is a black box.
- **No extra API key.** The AI agent already driving the MCP server (Claude Code, Cursor, any MCP client with vision) *is* the creative director. It grades the screenshot itself and passes the verdict back in. There is no server-side model call and no second key to buy.

## Prerequisites

Same setup as the read direction — see [Get started](/getting-started) for the full walkthrough:

- **Node.js ≥ 20**, the **Figma desktop app**, and an **MCP-compatible client** with vision (Claude Code, Cursor, Windsurf…).
- The `plumb-mcp` server wired into your client, and the Figma plugin **paired** (click "Pair with Plumb" once). The write tools build *through* the plugin, so pairing is required — a dry run is the only thing that works without it.

Optionally, drop free photo-provider keys into `.env` for on-brief imagery (Plumb still works without them, falling back to keyless placeholders):

```bash
UNSPLASH_ACCESS_KEY=…
PEXELS_API_KEY=…
PIXABAY_API_KEY=…
```

## The fast path — one brief, a whole page

`plumb_studio` runs the entire director pipeline in a single call: research → brand → compose → build. In your agent, just describe what you want:

> *Use plumb_studio to design a premium fintech dashboard.*

The agent calls `plumb_studio` with your brief. Under the hood it:

1. **Discovers references** — resolves a diverse set of best-in-class sites for the brief.
2. **Screenshots them live** — captures each reference and stages the PNGs.
3. **Synthesizes a brand** — reads the computed CSS of the first capture into a coherent semantic palette + type scale.
4. **Composes the page** — authors a full landing page (nav, hero, features, a reference-imagery gallery, a content split, a CTA, and a footer) with copy derived from the brief.
5. **Builds it** — compiles the design down through Plumb's DSL → PDS → emit-plan write path and executes it via the plugin onto a page (default `Studio`).

`plumb_studio` accepts:

| Input | What it does |
|---|---|
| `brief` | One-line description, e.g. `"a premium fintech dashboard"`. Drives reference discovery, palette, and copy. Required. |
| `count` | How many reference sites to study + screenshot. Default `4`. |
| `references` | Explicit reference URLs to include first, ahead of the discovered catalogue. |
| `pageName` | Figma page to build onto. Default `"Studio"`. |

It returns the picked `references`, the synthesized `brand`, the built `rootId`, the `ids` map (authored element handle → Figma node id), and an `authoredPath` — you feed those last three straight into the critique loop below.

## The transparent path — step by step

If you'd rather see each stage as its own artifact on the canvas, the director is decomposed into focused tools. This is the same pipeline `plumb_studio` runs, laid out so you can inspect and steer each step.

### 1 · Research references + build a brand board

> *Use plumb_brand to research references for a premium fintech dashboard.*

`plumb_brand` discovers the reference set, screenshots each site live, synthesizes a palette blended across *every* capture (so the most-agreed background / text / accent wins over any single site's quirks), then assembles a 1440-wide **Brand** page — reference screenshots + colour swatches + a type scale — and materialises the palette and type scale as **real Figma variables and text styles**. It takes the same `brief`, `count`, and `references` inputs as `plumb_studio`, and returns the picked `references`, the synthesized `brand`, and the built `rootId`.

Now you have a brand board on its own page, and named tokens your subsequent designs can bind to.

### 2 · Compose the page from the DSL

`plumb_studio` composes the page for you. If you want full control over the layout, `plumb_design` authors any design from Plumb's high-level **Design DSL** (semantic pages → sections → blocks + brand tokens) and builds it into Figma:

| Input | What it does |
|---|---|
| `doc` | A Design DSL document (`version "1"`: brand + pages of semantic sections). |
| `brief` | Optional intake to record intent (name, description, audience, tone, industry…) alongside the build. |
| `target` | Where to build — a new `page` frame, `into` an existing node, or `replace` one in place. |
| `mode` | `create` (default) for fresh nodes, or `sync` for an idempotent re-apply keyed on stable element handles. |
| `dryRun` | Compile + validate only, without touching Figma — the one write call that doesn't need the plugin paired. |

`plumb_design` returns the built `rootId`, the `ids` join map, and an `authoredPath` to the design it compiled — the exact inputs the review loop wants.

Need on-brief imagery, icons, or illustrations? `plumb_source` resolves them from the open web — `mode: "search"` returns ranked candidates (metadata only), `mode: "fetch"` downloads the best match. It's keyless-first (Iconify, Lorem Picsum, DiceBear always work) and picks one consistent icon family across a design.

### 3 · The director critique loop

This is the heart of the write direction, and where "agent-as-director" pays off. You have a built page (`rootId`, `ids`, `authoredPath`). Now grade it and push it up:

1. **Screenshot the render.** `plumb_screenshot` with `id: <rootId>` writes a PNG to `./plumb-screenshots/`. (`scale` defaults to `2`.)
2. **Grade it yourself.** *You* — the calling agent — look at the PNG and judge it as a demanding creative director: visual balance, focal flow, image composition/crop, optical spacing, and the "designed vs generated" gestalt a deterministic pass can't see. There's no server-side vision call; you already have vision and you already have the PNG.
3. **Hand the verdict to `plumb_review`.** Call `plumb_review` with the built root and your grade:

   ```jsonc
   {
     "id": "<rootId>",
     "ids": { /* EmitResult.ids — the join key */ },
     "authoredPath": "/tmp/plumb-authored-….json",
     "director": {
       "score": 78,
       "verdict": "Strong hero, but the gallery crops awkwardly and the CTA lacks contrast.",
       "issues": [
         { "dimension": "contrast", "severity": "error", "el": "cta", "message": "CTA text fails AA on the accent fill", "fix": "Darken the CTA background or switch to the on-primary text token." },
         { "dimension": "spacing", "severity": "warn", "el": "gallery", "message": "Cards are cramped", "fix": "Raise the grid gap to the lg spacing step." }
       ]
     }
   }
   ```

   `plumb_review` blends three axes into one 0–100 score:
   - **Structure** — it re-serializes the *built* Figma nodes back to a PDS and diffs them against the design the DSL compiled to (did emit build what you authored?), joined by `ids`. Same engine as [`plumb_verify`](/tools/plumb_verify).
   - **Design** — a deterministic rubric over hierarchy, spacing rhythm, contrast (WCAG AA), alignment, type-scale, and professional-vs-templated polish.
   - **Director** — *your* vision grade from step 2.

   The `director` issue `dimension` is one of `hierarchy`, `spacing`, `contrast`, `alignment`, `type-scale`, or `polish`; `severity` is `error`, `warn`, or `info`. With a director grade present, the weights reshuffle to structure `0.4` / design `0.3` / director `0.3`, and any director *error* blocks `done` — so the bar is harder, and more honest, to clear.

4. **Iterate.** `plumb_review` returns `score`, a `done` flag, and an error-first `topFixes` list. If `done` is false, apply the fixes, re-author, and re-build with `plumb_design(mode: "sync")` (which keeps the stable element handles), then review again — the score should climb. Loop until `done`, or set your own stop score with `accept` (e.g. `accept: 90`).

> The first `plumb_review` you run *without* a `director` grade echoes the exact grading criteria and output shape back to you in its `instruction`, so you always know how to grade the next screenshot.

## A copy-pasteable agent prompt

Drop this into Claude Code / Cursor to run the whole director loop end to end:

```txt
You are my design director. Using Plumb's write direction:

1. Call plumb_studio with brief: "a premium fintech dashboard for treasury teams".
   Keep the rootId, ids, and authoredPath it returns.
2. Call plumb_screenshot on that rootId.
3. Look at the screenshot and grade it as a demanding creative director —
   hierarchy, spacing, contrast, alignment, type-scale, polish.
4. Call plumb_review with { id: rootId, ids, authoredPath, director: { score, verdict, issues } }.
5. If done is false, apply the topFixes, re-build with plumb_design(mode: "sync"),
   and repeat from step 2. Stop when the score clears 90 (accept: 90) or after 4 passes.

Show me the References page, the Brand page, and the final composed page in Figma.
```

## What lands on your canvas

- A **References** section — live screenshots of the best-in-class sites the director studied.
- A **Brand** page — the extracted palette as real Figma variables, a type scale as named text styles, and swatches you can reuse.
- The **composed page** — a full, on-brand layout in real auto-layout frames, refined across the director loop.
- Screenshots of each render in `./plumb-screenshots/` (override with `PLUMB_SCREENSHOTS_DIR`).

Everything is a real, editable Figma artifact. Nothing is flattened, and nothing left your machine — the write direction never calls an external model, because the agent already driving Plumb does the design judgment.

## Where to go next

- The [tool reference](/tools/) documents each tool individually.
- The [figma → code](/getting-started) direction closes the *other* loop — extract a design and verify your build against it.
- The [recipes](/recipes) page collects common read-direction workflows.
