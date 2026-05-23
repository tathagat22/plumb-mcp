# Figma Community Submission — Plumb

Copy-paste-ready content for the Community submission form. Open Figma desktop → **Plugins → Development → Manage plugins in development** → select **Plumb** → **Publish new plugin**.

---

## Name

```
Plumb
```

## Tagline (≤ 100 characters)

```
Bring your Figma file into Claude Code, Cursor, and any other MCP-compatible AI coding agent.
```

(91 characters — within budget.)

Alternates if you want a different angle:

- *"A Model Context Protocol bridge between Figma and your AI coding agent."* (75 chars)
- *"Hand your AI coding agent an accurate, compact design spec from this Figma file."* (82 chars)

---

## Description (markdown)

```markdown
**Plumb is a Model Context Protocol (MCP) bridge between Figma and your AI coding agent.**

Plumb pairs this plugin with a small local server you run on your own machine. Your AI coding agent — Claude Code, Cursor, Windsurf, or any other MCP-compatible client — connects to that server and asks it for what it needs from the current Figma file:

- **Outline** every screen in the file
- **Read** any screen as a compact, normalised design spec (auto-layout already resolved to flexbox, design tokens deduped, no 100,000-token JSON dumps)
- **Export** icons as SVG and images as PNG straight to disk
- **Screenshot** any frame at any scale
- **List** components and their instance usages
- **Search** by node name and type
- **Verify** the code your agent built against the live design — structured deltas, no pixel diff

Plumb runs entirely on your own machine. Nothing about your design ever leaves it. The plugin only talks to a local MCP server on 127.0.0.1 — no analytics, no third-party endpoints, no telemetry.

The companion server is open source under the MIT license:
https://github.com/tathagat22/plumb-mcp

### Quick start

1. Install the server: `npm install -g plumb-mcp`
2. Configure your MCP client to spawn `plumb-mcp`
3. Run this plugin in your Figma file
4. Click **Pair with Plumb** once — the plugin collapses to a small dot
5. Ask your agent to read or implement any screen

### Works on any plan

Plumb reads through Figma's Plugin API, so it works on Free, Starter, Professional, Organization, and Enterprise plans. No PAT required for the primary path. No REST rate limits.

### Open source

Plumb is MIT-licensed. Source, issues, and roadmap:
https://github.com/tathagat22/plumb-mcp
```

---

## Tags (pick up to 12)

Recommended:
- `developer-tools`
- `dev-mode`
- `ai`
- `claude`
- `cursor`
- `code`
- `design-to-code`
- `automation`
- `productivity`
- `accessibility`
- `prototype`
- `design-systems`

---

## Category

**Developer tools** (or whichever the closest match is in Figma's category list — Figma's category list rotates; pick the one that mentions "developer" or "code").

---

## Support contact

Your support email. Or:
```
https://github.com/tathagat22/plumb-mcp/issues
```

(Figma accepts both an email and a URL — a public issues URL is fine and removes a personal address from the listing.)

---

## Comments policy

**Allow comments.** They're useful early signal and discoverability. Moderate aggressively for spam.

---

## Icon (128 × 128 PNG)

Spec for whoever designs it — keep it abstract, no copyrighted assets, no Figma logo:

- A pipe / pipeline / plumb-line motif works thematically
- High contrast, looks good at 32px (Figma also renders small)
- Solid background (not transparent) — many storefronts render against a neutral grey card; transparent icons get lost
- Avoid text in the icon

A minimal placeholder that ships well: solid coloured square + a single iconographic mark (a pipe, a chevron, the letter P in a clean sans).

---

## Cover image (1920 × 960 PNG)

Storefront banner. Shown big on the listing page.

- Show what Plumb does, not just the logo. A side-by-side mockup works well: a Figma screen on one side, an editor pane (Cursor / Claude Code) showing the same screen as code on the other, with a thin connector between them.
- Avoid screenshots of actual client work — anonymise.
- No tiny text — Community renders the cover at multiple sizes.

---

## Carousel screenshots (optional, up to 12, 1920 × 960 each)

Suggested set:
1. The plugin's paired-state dot in a Figma window (showing how unobtrusive it is)
2. A terminal showing `npm install -g plumb-mcp` followed by an MCP client connecting
3. The agent reading a screen — the chat / editor view with a tool call inline
4. The agent exporting assets — files appearing in `./plumb-assets/`
5. The agent running `plumb_verify` and getting back structured deltas
6. The architecture diagram from the README (binary HTTP + WS control)

---

## Pre-submission checklist

- [ ] Plugin builds: `npm run build:plugin` succeeds
- [ ] `manifest.json` `networkAccess.allowedDomains` is the narrow loopback list (not `["*"]`)
- [ ] `manifest.json` `reasoning` clearly states *local only, no third-party endpoints*
- [ ] Icon (128×128) and cover (1920×960) PNGs ready
- [ ] Listing description tested for typos
- [ ] Support contact resolves (open the URL or email yourself a test)
- [ ] Server is published to npm with a matching version (already: `plumb-mcp@0.1.1`)
- [ ] README at the repo URL is up to date

---

## What to expect from review

- **Turnaround**: usually 1–3 business days, sometimes longer at the end of a quarter.
- **Common rejection reasons**:
  - Vague or marketing-only description (Plumb's listing above is concrete; should pass)
  - Wildcard `networkAccess` (already narrowed)
  - Missing support contact
  - Plugin name conflicts (Plumb appears unclaimed; double-check at submission time)
  - Plugin requesting permissions it doesn't actually need
- **If rejected**: Figma sends a specific reason. Fix, resubmit (no penalty).

---

## After publishing

- The plugin gets a URL like `https://figma.com/community/plugin/<id>/plumb`. Add it to the repo README and to the npm package keywords/homepage if you want one-link install for new users.
- Updates are submitted the same way (**Publish update**, fill out a changelog).
