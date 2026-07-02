/**
 * The transparent step-by-step design studio — three tools that let a caller
 * WATCH Plumb design across separate named Figma pages, reviewing between steps:
 *
 *   1. plumb_studio_start(brief) — discover references, screenshot them live,
 *      synthesize a brand, and build a References + Brand board on a "Brand"
 *      page (real Figma Variables + text styles). Opens a session and returns
 *      its id + the synthesized brand.
 *   2. plumb_studio_kit(sessionId) — build the reusable component library
 *      (real Figma component masters: Button / FeatureCard / StatCard /
 *      PricingCard) onto a "Components" page and put it on show.
 *   3. plumb_studio_page(sessionId, { pageName, kind }) — compose a full product
 *      page (landing / features / pricing / dashboard) onto its own named page,
 *      reusing the session brand + reference imagery and instantiating the kit.
 *      Returns rootId + ids + authoredPath so plumb_review can grade it.
 *
 * Every step reuses the exact DSL → PDS → emit-plan write path plumb_brand /
 * plumb_studio use; the session store carries the brand, references, and the
 * already-staged reference screenshots forward so later steps never re-capture.
 */

import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { compile } from "../dsl/compile";
import { lowerToEmitPlan } from "../emit/plan";
import { requestApplyDesign, requestApplyFoundations, stageInboundAsset } from "../bridge/server";
import { bridge } from "../bridge/store";
import { PlumbError } from "../errors";
import { emitStudio } from "../studio/events";
import { fail, ok } from "./shared";
import { discoverReferences } from "../brand/references";
import { captureUrls } from "../brand/capture";
import { synthesizeBrandFromMany } from "../brand/palette";
import { buildBrandBoard } from "../brand/board";
import { buildComponentKit } from "../studio/kit";
import { composeSections } from "../studio/compose";
import { createSession, getSession, updateSession } from "../studio/session";
import type { PageKind } from "../studio/compose";
import type { StudioCapture } from "../studio/session";
import type { CompileResult } from "../dsl/compile";
import type { LowerAssetInfo } from "../emit/plan";
import type {
  AssetResolver,
  AssetSpec,
  BrandColors as DslBrandColors,
  DesignDoc,
  ResolvedAsset,
  Section,
} from "../dsl/schema";
import type { ApplyProgressMessage, EmitTarget } from "../bridge/protocol";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

/* ------------------------------------------------------------------------ */
/* Shared helpers                                                             */
/* ------------------------------------------------------------------------ */

const STOPWORDS = new Set(["a", "an", "the", "for", "with", "of", "and", "to", "that", "this", "your"]);

/** Pull a short product-name-shaped phrase out of a free-form brief (copy of
 *  studio.ts's deriveName so the flow names brands identically). */
function deriveName(brief: string): string {
  const words = brief.split(/\s+/).filter(Boolean);
  const significant = words.filter((w) => !STOPWORDS.has(w.toLowerCase()));
  const picked = (significant.length ? significant : words).slice(0, 3);
  const name = picked.map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
  return name || "Studio";
}

function toEmitTarget(pageName: string): EmitTarget {
  return { kind: "page", pageName };
}

/** The shared brand block every studio-flow page compiles against — identical
 *  to buildStudioDoc's brand (fonts / colours / type scale / spacing / radius),
 *  so every step inherits one coherent system from the session's palette. */
function studioBrandBlock(colors: DslBrandColors): DesignDoc["brand"] {
  return {
    fonts: { heading: "Inter", body: "Inter" },
    colors,
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
  };
}

/** No-op resolver for a page that references no external imagery (the kit). */
const bareResolver: AssetResolver = {
  async resolve(spec: AssetSpec): Promise<ResolvedAsset> {
    return { kind: spec.kind ?? "photo" };
  },
};

/** Build a resolver + emit-plan asset map over a session's already-staged
 *  reference screenshots, so composed pages reuse the step-1 captures (keyed by
 *  the reference URL) without re-capturing anything. */
function resolverFromCaptures(captures: StudioCapture[]): {
  resolver: AssetResolver;
  assets: Record<string, LowerAssetInfo>;
} {
  const assets: Record<string, LowerAssetInfo> = {};
  const byUrl = new Map<string, StudioCapture>();
  for (const cap of captures) {
    assets[cap.assetKey] = { ext: "png", kind: "image", w: cap.w, h: cap.h };
    byUrl.set(cap.url, cap);
  }
  const resolver: AssetResolver = {
    async resolve(spec: AssetSpec): Promise<ResolvedAsset> {
      const hit = byUrl.get(spec.query);
      if (hit) return { assetId: hit.assetKey, kind: "photo", w: hit.w, h: hit.h, scaleMode: "fill" };
      return { kind: spec.kind ?? "photo" };
    },
  };
  return { resolver, assets };
}

/** Guard: the flow writes through the plugin path. */
function requirePaired(tool: string): void {
  if (!bridge.paired) {
    throw new PlumbError(
      "No Figma plugin is paired.",
      `${tool} writes through the plugin path — run the Plumb plugin in Figma and click 'Pair with Plumb'.`,
    );
  }
}

/* ------------------------------------------------------------------------ */
/* 1. plumb_studio_start — References + Brand                                 */
/* ------------------------------------------------------------------------ */

const START_DESCRIPTION =
  "STEP 1 of the transparent studio flow. Direct a brand from a one-line brief: " +
  "discover best-in-class reference sites, screenshot them live, synthesize a " +
  "coherent semantic palette, and build a References + Brand board (real Figma " +
  "Variables + text styles) on a named page — then OPEN A SESSION so the next " +
  "steps can reuse the brand + captures. Returns { sessionId, name, brand, " +
  "references }. Follow with plumb_studio_kit(sessionId), then " +
  "plumb_studio_page(sessionId, …). Requires the Plumb plugin to be paired.";

export function registerPlumbStudioStart(server: McpServer): void {
  server.registerTool(
    "plumb_studio_start",
    {
      title: "Plumb · studio start (references + brand + open session)",
      description: START_DESCRIPTION,
      inputSchema: {
        brief: z.string().min(1).describe('One-line description, e.g. "a premium fintech dashboard".'),
        count: z.number().int().positive().optional().describe("How many reference sites to study (default 4)."),
        references: z.array(z.string()).optional().describe("Explicit reference URLs to study first."),
        pageName: z.string().optional().describe('Figma page for the brand board (default "Brand").'),
      },
      annotations: { readOnlyHint: false, idempotentHint: false, openWorldHint: false },
    },
    async (args) => {
      try {
        const brief = typeof args.brief === "string" ? args.brief.trim() : "";
        if (!brief) {
          throw new PlumbError(
            "A brief is required.",
            'Pass `brief` — a one-line description like "a premium fintech dashboard".',
          );
        }
        const count = args.count && args.count > 0 ? Math.floor(args.count) : 4;
        const references = Array.isArray(args.references) ? args.references : undefined;
        const pageName = typeof args.pageName === "string" && args.pageName.trim() ? args.pageName.trim() : "Brand";

        const refs = discoverReferences({ description: brief, references }, count);
        if (refs.length === 0) {
          throw new PlumbError(
            "Could not resolve any references for the brief.",
            "Add explicit `references` URLs or broaden the brief wording, then retry.",
          );
        }
        requirePaired("plumb_studio_start");

        emitStudio({ kind: "log", tool: "plumb_studio_start", screen: pageName, summary: `capturing ${refs.length} reference site(s)…` });
        const { captures, misses } = await captureUrls(refs.map((r) => r.url), { maxHeight: 2200, settleMs: 1600 });
        for (const cap of captures) {
          emitStudio({ kind: "log", tool: "plumb_studio_start", screen: pageName, summary: `captured ${cap.url} (${cap.width}×${cap.height})` });
        }

        const rawPalettes = captures.map((c) => c.palette).filter((p): p is NonNullable<typeof p> => !!p);
        if (rawPalettes.length === 0) {
          throw new PlumbError(
            "No reference screenshot yielded a palette to synthesize a brand from.",
            "Check network access + that Chrome can reach the reference sites (PLUMB_CHROME), then retry.",
          );
        }
        const brand = synthesizeBrandFromMany(rawPalettes);

        // Build the References + Brand board (+ real Figma foundations) on its page.
        const { doc, resolver, assets, foundations } = buildBrandBoard({
          brief: { description: brief },
          references: refs,
          captures,
          brand,
        });
        let foundationsWarnings: string[] = [];
        try {
          const fr = await requestApplyFoundations(foundations);
          foundationsWarnings = fr.warnings;
        } catch (e) {
          foundationsWarnings = [`foundations apply failed: ${e instanceof Error ? e.message : String(e)}`];
        }

        let compiled: CompileResult;
        try {
          compiled = await compile(doc, { assets: resolver });
        } catch (e) {
          throw new PlumbError(
            `Compiling the brand board failed: ${e instanceof Error ? e.message : String(e)}`,
            "This is usually a malformed section/block. Retry, or simplify the brief.",
          );
        }
        const planId = `studio-start-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const plan = lowerToEmitPlan(compiled.doc, {
          planId,
          target: toEmitTarget(pageName),
          mode: "create",
          prune: false,
          reveal: true,
          components: compiled.components,
          assets,
        });
        const { result, error } = await requestApplyDesign(plan, (p: ApplyProgressMessage) => {
          emitStudio({ kind: "log", tool: "plumb_studio_start", screen: pageName, summary: `${p.phase} ${p.done}/${p.total}${p.note ? ` — ${p.note}` : ""}` });
        });
        if (error || !result) {
          throw new PlumbError(
            `The plugin could not build the brand board: ${error ?? "no result returned"}`,
            "Check that the plugin is still paired, then retry.",
          );
        }

        // Stage each capture independently for the session, so later page steps
        // reuse these keys (the in-process asset store keeps them fetchable).
        const sessionCaptures: StudioCapture[] = captures.map((c) => ({
          url: c.url,
          assetKey: stageInboundAsset(c.png, "png"),
          w: c.width,
          h: c.height,
        }));

        const session = createSession({
          brief,
          name: deriveName(brief),
          brand: brand as unknown as DslBrandColors,
          refs,
          captures: sessionCaptures,
        });

        emitStudio({ kind: "screen", tool: "plumb_studio_start", screen: pageName, summary: `brand ready — session ${session.id}` });

        return ok({
          sessionId: session.id,
          name: session.name,
          brand,
          references: refs.map((r) => ({ name: r.name, url: r.url })),
          captured: captures.length,
          misses,
          foundationsWarnings,
          rootId: result.rootId,
          next: `Watch the "${pageName}" page. Then call plumb_studio_kit("${session.id}") to build the component library.`,
        });
      } catch (e) {
        return fail(e);
      }
    },
  );
}

/* ------------------------------------------------------------------------ */
/* 2. plumb_studio_kit — the component library                               */
/* ------------------------------------------------------------------------ */

const KIT_DESCRIPTION =
  "STEP 2 of the transparent studio flow. Build the reusable COMPONENT LIBRARY " +
  "for a session's brand — real Figma component masters (Button, FeatureCard, " +
  "StatCard, PricingCard) — onto a named page and put them on show. The masters " +
  "inherit the session palette + type scale. Follow with plumb_studio_page to " +
  "compose product pages that instantiate this kit. Requires a sessionId from " +
  "plumb_studio_start and the Plumb plugin paired.";

export function registerPlumbStudioKit(server: McpServer): void {
  server.registerTool(
    "plumb_studio_kit",
    {
      title: "Plumb · studio kit (build the component library)",
      description: KIT_DESCRIPTION,
      inputSchema: {
        sessionId: z.string().min(1).describe("Session id from plumb_studio_start."),
        pageName: z.string().optional().describe('Figma page for the component library (default "Components").'),
      },
      annotations: { readOnlyHint: false, idempotentHint: false, openWorldHint: false },
    },
    async (args) => {
      try {
        const sessionId = typeof args.sessionId === "string" ? args.sessionId.trim() : "";
        const session = sessionId ? getSession(sessionId) : undefined;
        if (!session) {
          throw new PlumbError(
            "Unknown or expired sessionId.",
            "Call plumb_studio_start first and pass the sessionId it returns.",
          );
        }
        requirePaired("plumb_studio_kit");
        const pageName = typeof args.pageName === "string" && args.pageName.trim() ? args.pageName.trim() : "Components";

        const kit = buildComponentKit();
        const doc: DesignDoc = {
          version: "1",
          meta: { name: `${session.name} — Components`, description: `Component library for ${session.brief}` },
          brand: studioBrandBlock(session.brand),
          components: kit.components,
          pages: [{ name: pageName, width: 1440, bg: "@bg", sections: kit.showcase }],
        };

        let compiled: CompileResult;
        try {
          compiled = await compile(doc, { assets: bareResolver });
        } catch (e) {
          throw new PlumbError(
            `Compiling the component library failed: ${e instanceof Error ? e.message : String(e)}`,
            "Retry; if it persists this is a kit authoring bug.",
          );
        }
        const planId = `studio-kit-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const plan = lowerToEmitPlan(compiled.doc, {
          planId,
          target: toEmitTarget(pageName),
          mode: "create",
          prune: false,
          reveal: true,
          components: compiled.components,
        });
        const { result, error } = await requestApplyDesign(plan, (p: ApplyProgressMessage) => {
          emitStudio({ kind: "log", tool: "plumb_studio_kit", screen: pageName, summary: `${p.phase} ${p.done}/${p.total}${p.note ? ` — ${p.note}` : ""}` });
        });
        if (error || !result) {
          throw new PlumbError(
            `The plugin could not build the component library: ${error ?? "no result returned"}`,
            "Check that the plugin is still paired, then retry.",
          );
        }

        const componentNames = kit.components.map((c) => c.name);
        updateSession(session.id, { kit: { components: kit.components, componentNames } });

        emitStudio({ kind: "screen", tool: "plumb_studio_kit", screen: pageName, summary: `component library built — ${componentNames.length} component(s)` });

        return ok({
          sessionId: session.id,
          components: componentNames,
          rootId: result.rootId,
          next: `Watch the "${pageName}" page. Then call plumb_studio_page("${session.id}", { pageName, kind }) to compose a product page (landing / features / pricing / dashboard).`,
        });
      } catch (e) {
        return fail(e);
      }
    },
  );
}

/* ------------------------------------------------------------------------ */
/* 3. plumb_studio_page — compose a product page                             */
/* ------------------------------------------------------------------------ */

const PAGE_DESCRIPTION =
  "STEP 3 of the transparent studio flow (repeatable). Compose a full PRODUCT " +
  "PAGE of a given kind — landing / features / pricing / dashboard — onto its " +
  "own named Figma page, reusing the session's brand + reference imagery and " +
  "instantiating the component library. Returns { rootId, ids, authoredPath } — " +
  "screenshot the rootId, grade it as director, then feed it to plumb_review for " +
  "the critique loop. Call once per page to build a whole product page by page. " +
  "Requires a sessionId from plumb_studio_start and the Plumb plugin paired.";

const PAGE_KINDS = ["landing", "features", "pricing", "dashboard"] as const;

export function registerPlumbStudioPage(server: McpServer): void {
  server.registerTool(
    "plumb_studio_page",
    {
      title: "Plumb · studio page (compose a product page)",
      description: PAGE_DESCRIPTION,
      inputSchema: {
        sessionId: z.string().min(1).describe("Session id from plumb_studio_start."),
        pageName: z.string().min(1).describe('Figma page to build onto, e.g. "Landing".'),
        kind: z.enum(PAGE_KINDS).optional().describe("Which page to compose (default landing)."),
      },
      annotations: { readOnlyHint: false, idempotentHint: false, openWorldHint: false },
    },
    async (args) => {
      try {
        const sessionId = typeof args.sessionId === "string" ? args.sessionId.trim() : "";
        const session = sessionId ? getSession(sessionId) : undefined;
        if (!session) {
          throw new PlumbError(
            "Unknown or expired sessionId.",
            "Call plumb_studio_start first and pass the sessionId it returns.",
          );
        }
        requirePaired("plumb_studio_page");
        const pageName = typeof args.pageName === "string" && args.pageName.trim() ? args.pageName.trim() : "";
        if (!pageName) {
          throw new PlumbError("A pageName is required.", 'Pass `pageName` — the Figma page to build onto, e.g. "Landing".');
        }
        const kind: PageKind = PAGE_KINDS.includes(args.kind as PageKind) ? (args.kind as PageKind) : "landing";

        const { resolver, assets } = resolverFromCaptures(session.captures);
        const sections: Section[] = composeSections(kind, {
          brief: session.brief,
          name: session.name,
          refs: session.refs,
          refImageQuery: (ref) => ref.url,
          kitComponentNames: session.kit?.componentNames ?? [],
        });

        const doc: DesignDoc = {
          version: "1",
          meta: { name: `${session.name} — ${kind}`, description: session.brief },
          brand: studioBrandBlock(session.brand),
          components: session.kit?.components ?? [],
          pages: [{ name: pageName, width: 1440, bg: "@bg", sections }],
        };

        emitStudio({ kind: "log", tool: "plumb_studio_page", screen: pageName, summary: `composing ${kind} page…` });

        let compiled: CompileResult;
        try {
          compiled = await compile(doc, { assets: resolver });
        } catch (e) {
          throw new PlumbError(
            `Compiling the ${kind} page failed: ${e instanceof Error ? e.message : String(e)}`,
            "This is usually a malformed section/block. Retry, or try another kind.",
          );
        }
        const planId = `studio-page-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const plan = lowerToEmitPlan(compiled.doc, {
          planId,
          target: toEmitTarget(pageName),
          mode: "create",
          prune: false,
          reveal: true,
          components: compiled.components,
          assets,
        });
        const { result, error } = await requestApplyDesign(plan, (p: ApplyProgressMessage) => {
          emitStudio({ kind: "log", tool: "plumb_studio_page", screen: pageName, summary: `${p.phase} ${p.done}/${p.total}${p.note ? ` — ${p.note}` : ""}` });
        });
        if (error || !result) {
          throw new PlumbError(
            `The plugin could not build the ${kind} page: ${error ?? "no result returned"}`,
            "Check that the plugin is still paired, then retry.",
          );
        }

        const summary = `built ${kind} page — ${result.created} node(s)`;
        emitStudio({ kind: "screen", tool: "plumb_studio_page", screen: pageName, summary });

        // Persist the authored PDS so plumb_review can diff built-vs-authored.
        let authoredPath: string | undefined;
        try {
          authoredPath = join(tmpdir(), `plumb-authored-${planId}.json`);
          writeFileSync(authoredPath, JSON.stringify(compiled.doc));
        } catch {
          authoredPath = undefined;
        }

        return ok({
          sessionId: session.id,
          kind,
          rootId: result.rootId,
          ids: result.ids,
          authoredPath,
          warnings: compiled.warnings,
          summary,
          next: "Screenshot rootId, grade it as director, then plumb_review with { id: rootId, ids, authoredPath, director }.",
        });
      } catch (e) {
        return fail(e);
      }
    },
  );
}
