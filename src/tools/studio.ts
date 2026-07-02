/**
 * `plumb_studio` — the unified design director. One brief in, a full,
 * brand-consistent, composed landing page on the Figma canvas out.
 *
 * Pipeline (server-only, no plugin logic, no network LLM calls):
 *   1. discoverReferences + captureUrls + synthesizeBrand — EXACTLY the
 *      brand.ts pass — turns the brief into a set of live reference
 *      screenshots and a synthesized semantic palette.
 *   2. Compose a full landing-page DesignDoc from that brand: nav, hero,
 *      features, a gallery card-grid, a content split, a cta, and a footer —
 *      with tasteful copy derived from the brief and the reference
 *      screenshots reused as hero/gallery imagery (staged exactly like
 *      board.ts's asset resolver).
 *   3. compile() -> lowerToEmitPlan() -> requestApplyDesign() on a named page.
 *
 * Returns ids + authoredPath so the caller can immediately hand this build to
 * plumb_review for the director critique loop.
 */

import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { compile } from "../dsl/compile";
import { lowerToEmitPlan } from "../emit/plan";
import { requestApplyDesign, stageInboundAsset } from "../bridge/server";
import { bridge } from "../bridge/store";
import { PlumbError } from "../errors";
import { emitStudio } from "../studio/events";
import { fail, ok } from "./shared";
import { discoverReferences } from "../brand/references";
import { captureUrls } from "../brand/capture";
import { synthesizeBrand } from "../brand/palette";
import type { Reference } from "../brand/references";
import type { CompileResult } from "../dsl/compile";
import type { LowerAssetInfo } from "../emit/plan";
import type {
  AssetResolver,
  AssetSpec,
  Block,
  BrandColors as DslBrandColors,
  Card,
  DesignDoc,
  ResolvedAsset,
  Section,
} from "../dsl/schema";
import type { ApplyProgressMessage, EmitTarget } from "../bridge/protocol";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

const DESCRIPTION =
  "Direct a FULL landing page from a one-line brief and BUILD it into the " +
  "paired Figma file — the headline director-completion tool. Given a brief " +
  "(e.g. \"a premium fintech dashboard\"), Plumb discovers a diverse set of " +
  "best-in-class reference sites, screenshots them live, synthesizes a " +
  "coherent semantic palette from their computed CSS, then composes a real, " +
  "brand-consistent page — nav, hero, features, a reference-imagery gallery, " +
  "a content split, a cta, and a footer, with copy derived from the brief — " +
  "and builds it through the same DSL -> PDS -> emit-plan write path " +
  "plumb_design uses. Returns the picked references, the synthesized brand " +
  "palette, the created node ids (keyed by authored element handle), and an " +
  "authoredPath — feed both straight into plumb_review for the director " +
  "critique loop. Requires the Plumb plugin to be paired.";

const STOPWORDS = new Set([
  "a", "an", "the", "for", "with", "of", "and", "to", "that", "this", "your",
]);

/** Pull a short product-name-shaped phrase out of a free-form brief. */
function deriveName(brief: string): string {
  const words = brief.split(/\s+/).filter(Boolean);
  const significant = words.filter((w) => !STOPWORDS.has(w.toLowerCase()));
  const picked = (significant.length ? significant : words).slice(0, 3);
  const name = picked.map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
  return name || "Studio";
}

function capFirst(s: string): string {
  return s.length ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

/** Strip a leading article and trailing punctuation, e.g. "a premium fintech
 *  dashboard." -> "premium fintech dashboard". */
function bareBrief(brief: string): string {
  return brief.trim().replace(/^(a|an|the)\s+/i, "").replace(/[.!?]+$/, "");
}

/** Map the fixed page target to the wire {@link EmitTarget} — same shape as
 *  brand.ts's toEmitTarget for the `page` kind. */
function toEmitTarget(pageName: string): EmitTarget {
  return { kind: "page", pageName };
}

/**
 * Compose the full landing-page DesignDoc from the derived brand + captured
 * references. Mirrors buildBrandBoard's shape (doc + resolver + staged
 * assets), but authors a real marketing page instead of a reference board.
 */
function buildStudioDoc(input: {
  brief: string;
  pageName: string;
  refs: Reference[];
  captures: { url: string; png: Buffer; width: number; height: number }[];
  brand: DslBrandColors;
}): { doc: DesignDoc; resolver: AssetResolver; assets: Record<string, LowerAssetInfo> } {
  const { brief, pageName, refs, captures, brand } = input;
  if (refs.length === 0) {
    throw new Error("buildStudioDoc requires at least one reference.");
  }

  // 1. Stage every capture's PNG bytes, indexed by source URL — identical
  //    pattern to buildBrandBoard / makeSourcingResolver.
  const assets: Record<string, LowerAssetInfo> = {};
  const keyByUrl = new Map<string, { key: string; w: number; h: number }>();
  for (const cap of captures) {
    const key = stageInboundAsset(cap.png, "png");
    assets[key] = { ext: "png", kind: "image", w: cap.width, h: cap.height };
    keyByUrl.set(cap.url, { key, w: cap.width, h: cap.height });
  }
  const resolver: AssetResolver = {
    async resolve(spec: AssetSpec): Promise<ResolvedAsset> {
      const hit = keyByUrl.get(spec.query);
      if (hit) {
        return { assetId: hit.key, kind: "photo", w: hit.w, h: hit.h, scaleMode: "fill" };
      }
      return { kind: spec.kind ?? "photo" };
    },
  };

  // 2. Tasteful copy, derived from the brief.
  const name = deriveName(brief);
  const bare = bareBrief(brief);
  const headline = capFirst(bare) || name;
  const sub =
    `A complete, on-brand landing page for ${bare || brief} — composed ` +
    `automatically from a single brief and ${refs.length} live reference site(s).`;

  const heroRef = refs[0] as Reference;
  const splitRef = (refs[refs.length - 1] ?? refs[0]) as Reference;
  const galleryCards: Card[] = Array.from({ length: 3 }, (_, i) => {
    const ref = refs[i % refs.length] as Reference;
    return { image: { query: ref.url, kind: "photo" }, title: ref.name, body: ref.why };
  });

  const features: Card[] = [
    {
      icon: "lucide:sparkles",
      title: "Crafted for the brief",
      body: `Every section is composed to match the tone of "${bare || brief}" — not filled into a generic template.`,
    },
    {
      icon: "lucide:palette",
      title: "One coherent palette",
      body: `Colours are extracted live from ${refs.length} reference site(s) and synthesized into a single semantic system.`,
    },
    {
      icon: "lucide:layout-grid",
      title: "Built end to end",
      body: "Nav, hero, features, gallery, and a call to action — a full page in one director pass.",
    },
  ];

  const contentChildren: Block[] = [
    {
      type: "stack",
      name: "split",
      dir: "row",
      gap: 64,
      align: "center",
      w: "fill",
      children: [
        {
          type: "stack",
          name: "split-copy",
          dir: "col",
          gap: 16,
          grow: 1,
          children: [
            { type: "text", text: "How it comes together", style: "h2" },
            {
              type: "text",
              text:
                `Plumb studied ${refs.length} live reference site(s), synthesized a coherent ` +
                "palette from their computed CSS, then composed this page from semantic " +
                "sections — nav, hero, features, gallery, and a call to action — all matched " +
                "to the brief.",
              style: "body",
              color: "@muted",
              w: "fill",
            },
          ],
        },
        {
          type: "image",
          src: { query: splitRef.url, kind: "photo" },
          w: "fill",
          h: 360,
          radius: 12,
          fit: "crop",
          grow: 1,
        },
      ],
    },
  ];

  const sections: Section[] = [
    {
      role: "nav",
      sticky: true,
      brand: { text: name },
      links: [
        { label: "Product", href: "#product" },
        { label: "Features", href: "#features" },
        { label: "Gallery", href: "#gallery" },
        { label: "About", href: "#about" },
      ],
      actions: [
        { type: "button", label: "Sign in", variant: "ghost" },
        { type: "button", label: "Get started", variant: "primary", icon: "lucide:arrow-right", iconPos: "right" },
      ],
    },
    {
      role: "hero",
      layout: "split-right",
      maxWidth: 1200,
      eyebrow: "INTRODUCING",
      headline,
      sub,
      actions: [
        { type: "button", label: "Get started", variant: "primary", size: "lg" },
        { type: "button", label: "See how it works", variant: "outline", size: "lg" },
      ],
      media: {
        type: "image",
        src: { query: heroRef.url, kind: "photo", role: "hero" },
        w: "fill",
        h: 420,
        radius: "lg",
      },
    },
    {
      role: "features",
      heading: "Everything you need",
      bg: "@surface",
      layout: "row",
      features,
    },
    {
      role: "card-grid",
      heading: "Inspired by the best",
      columns: 3,
      cards: galleryCards,
    },
    { role: "content", children: contentChildren },
    {
      role: "cta",
      bg: "@primary",
      theme: "dark",
      headline: `Start with ${name}`,
      sub: "Free to explore — composed and ready to ship.",
      actions: [{ type: "button", label: "Get started", variant: "secondary", size: "lg" }],
    },
    {
      role: "footer",
      bg: "@surface",
      brand: { text: name },
      columns: [
        { title: "Product", links: [{ label: "Features" }, { label: "Gallery" }, { label: "Pricing" }] },
        { title: "Company", links: [{ label: "About" }, { label: "Contact" }] },
      ],
      legal: `© ${new Date().getFullYear()} ${name}. Built with Plumb.`,
    },
  ];

  const doc: DesignDoc = {
    version: "1",
    meta: { name, description: brief },
    brand: {
      fonts: { heading: "Inter", body: "Inter" },
      colors: brand,
      type: {
        display: { size: 64, weight: 600, line: 1.05, font: "heading" },
        h1: { size: 40, weight: 600, line: 1.1, font: "heading" },
        h2: { size: 28, weight: 600, line: 1.2, font: "heading" },
        h3: { size: 20, weight: 600, line: 1.3, font: "heading" },
        body: { size: 16, weight: 400, line: 1.6, font: "body" },
        small: { size: 13, weight: 400, line: 1.5, font: "body" },
        label: { size: 12, weight: 600, line: 1.2, font: "body", transform: "upper" },
      },
      spacing: { xs: 4, sm: 8, md: 16, lg: 24, xl: 48 },
      radius: { sm: 8, md: 12, lg: 16, full: "full" },
    },
    pages: [{ name: pageName, width: 1440, bg: "@bg", sections }],
  };

  return { doc, resolver, assets };
}

/** Registers the `plumb_studio` MCP write tool — the unified design director. */
export function registerPlumbStudio(server: McpServer): void {
  server.registerTool(
    "plumb_studio",
    {
      title: "Plumb · studio (direct + build a full page)",
      description: DESCRIPTION,
      inputSchema: {
        brief: z
          .string()
          .min(1)
          .describe(
            "One-line description of what's being built, e.g. \"a premium " +
              "fintech dashboard\". Drives reference discovery, palette, and copy.",
          ),
        count: z
          .number()
          .int()
          .positive()
          .optional()
          .describe("How many reference sites to study + screenshot (default 4)."),
        references: z
          .array(z.string())
          .optional()
          .describe(
            "Explicit reference URLs to include first — always studied ahead " +
              "of the discovered catalogue.",
          ),
        pageName: z
          .string()
          .optional()
          .describe("Figma page to build the landing page onto (default \"Studio\")."),
      },
      annotations: { readOnlyHint: false, idempotentHint: false, openWorldHint: false },
    },
    async (args) => {
      try {
        // --- 1. Parse / guard input ----------------------------------------
        const brief = typeof args.brief === "string" ? args.brief.trim() : "";
        if (!brief) {
          throw new PlumbError(
            "A brief is required.",
            "Pass `brief` — a one-line description like \"a premium fintech dashboard\".",
          );
        }
        const count = args.count && args.count > 0 ? Math.floor(args.count) : 4;
        const references = Array.isArray(args.references) ? args.references : undefined;
        const pageName = typeof args.pageName === "string" && args.pageName.trim()
          ? args.pageName.trim()
          : "Studio";

        // --- 2. Discover references ------------------------------------------
        const refs = discoverReferences({ description: brief, references }, count);
        if (refs.length === 0) {
          throw new PlumbError(
            "Could not resolve any references for the brief.",
            "Add explicit `references` URLs or broaden the brief wording, then retry.",
          );
        }

        // --- 3. A real build needs the paired plugin -------------------------
        if (!bridge.paired) {
          throw new PlumbError(
            "No Figma plugin is paired.",
            "plumb_studio writes through the plugin path — run the Plumb plugin in Figma and click 'Pair with Plumb'.",
          );
        }

        // --- 4. Screenshot every reference -----------------------------------
        emitStudio({
          kind: "log",
          tool: "plumb_studio",
          screen: pageName,
          summary: `capturing ${refs.length} reference site(s)…`,
        });
        const { captures, misses } = await captureUrls(
          refs.map((r) => r.url),
          { maxHeight: 2200, settleMs: 1600 },
        );
        for (const cap of captures) {
          emitStudio({
            kind: "log",
            tool: "plumb_studio",
            screen: pageName,
            summary: `captured ${cap.url} (${cap.width}×${cap.height})`,
          });
        }
        for (const miss of misses) {
          emitStudio({
            kind: "log",
            tool: "plumb_studio",
            screen: pageName,
            summary: `missed ${miss.url} — ${miss.error}`,
          });
        }

        // --- 5. Synthesize the brand palette from the first capture ---------
        const seed = captures.find((c) => c.palette);
        if (!seed || !seed.palette) {
          throw new PlumbError(
            "No reference screenshot yielded a palette to synthesize a brand from.",
            "Check network access + that Chrome can reach the reference sites (PLUMB_CHROME), then retry.",
          );
        }
        const brand = synthesizeBrand(seed.palette);

        // --- 6. Compose the full landing-page doc + asset resolver ----------
        emitStudio({
          kind: "log",
          tool: "plumb_studio",
          screen: pageName,
          summary: "composing landing page (nav, hero, features, gallery, cta, footer)…",
        });
        const { doc, resolver, assets } = buildStudioDoc({
          brief,
          pageName,
          refs,
          captures,
          brand: brand as unknown as DslBrandColors,
        });

        // --- 7. Compile DSL -> PDS, lower PDS -> Figma-native EmitPlan -------
        let compiled: CompileResult;
        try {
          compiled = await compile(doc, { assets: resolver });
        } catch (e) {
          throw new PlumbError(
            `Compiling the studio page failed: ${e instanceof Error ? e.message : String(e)}`,
            "This is usually a malformed section/block. Retry, or simplify the brief.",
          );
        }

        const planId = `studio-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const plan = lowerToEmitPlan(compiled.doc, {
          planId,
          target: toEmitTarget(pageName),
          mode: "create",
          prune: false,
          reveal: true,
          components: compiled.components,
          assets,
        });

        // --- 8. Build in Figma via the bridge write path ---------------------
        const { result, error } = await requestApplyDesign(
          plan,
          (p: ApplyProgressMessage) => {
            emitStudio({
              kind: "log",
              tool: "plumb_studio",
              screen: pageName,
              summary: `${p.phase} ${p.done}/${p.total}${p.note ? ` — ${p.note}` : ""}`,
            });
          },
        );
        if (error || !result) {
          throw new PlumbError(
            `The plugin could not build the studio page: ${error ?? "no result returned"}`,
            "Check that the plugin is still paired, then retry.",
          );
        }

        const summary =
          `built "${doc.meta?.name ?? pageName}" — ${refs.length} reference(s), ${result.created} node(s)`;

        emitStudio({
          kind: "screen",
          tool: "plumb_studio",
          screen: pageName,
          summary,
        });

        // Persist the authored PDS so plumb_review can diff built-vs-authored,
        // exactly like design.ts's finish().
        let authoredPath: string | undefined;
        try {
          authoredPath = join(tmpdir(), `plumb-authored-${planId}.json`);
          writeFileSync(authoredPath, JSON.stringify(compiled.doc));
        } catch {
          authoredPath = undefined;
        }

        // --- 9. Success envelope ----------------------------------------------
        return ok({
          brief,
          references: refs.map((r) => ({ name: r.name, url: r.url })),
          captured: captures.length,
          misses,
          brand,
          rootId: result.rootId,
          ids: result.ids,
          authoredPath,
          warnings: compiled.warnings,
          summary,
          next:
            "Built. Run plumb_review with { id: rootId, ids, authoredPath } to score built-vs-authored and get the fix list.",
        });
      } catch (e) {
        return fail(e);
      }
    },
  );
}
