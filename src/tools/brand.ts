import { z } from "zod";
import { compile } from "../dsl/compile";
import { lowerToEmitPlan } from "../emit/plan";
import { requestApplyDesign, requestApplyFoundations } from "../bridge/server";
import { bridge } from "../bridge/store";
import { PlumbError } from "../errors";
import { emitStudio } from "../studio/events";
import { fail, ok } from "./shared";
import { discoverReferences } from "../brand/references";
import { captureUrls } from "../brand/capture";
import { synthesizeBrandFromMany } from "../brand/palette";
import { buildBrandBoard } from "../brand/board";
import type { CompileResult } from "../dsl/compile";
import type { ApplyProgressMessage, EmitTarget } from "../bridge/protocol";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

const DESCRIPTION =
  "Direct a brand board from a one-line brief and BUILD it into the paired " +
  "Figma file. Given a brief (e.g. \"a premium fintech dashboard\"), Plumb " +
  "discovers a diverse set of best-in-class reference sites, screenshots them " +
  "live, synthesizes a coherent semantic palette from their computed CSS, and " +
  "assembles a single 1440-wide Brand page (reference screenshots + colour " +
  "swatches + a type scale) — then compiles it down through the same DSL → PDS " +
  "→ emit-plan write path plumb_design uses and executes it via the plugin. " +
  "Returns the picked references, the synthesized brand palette, and the built " +
  "root node id. Requires the Plumb plugin to be paired.";

/**
 * Map the fixed Brand-page target to the wire {@link EmitTarget}. The brand
 * board always builds a fresh top-level frame on a page named "Brand", mirroring
 * design.ts's toEmitTarget for the `page` kind.
 */
function toEmitTarget(t: { kind: "page"; pageName?: string }): EmitTarget {
  return { kind: "page", pageName: t.pageName };
}

/** Registers the `plumb_brand` MCP write tool — the brand-director pass. */
export function registerBrandTool(server: McpServer): void {
  server.registerTool(
    "plumb_brand",
    {
      title: "Plumb · brand (direct + build)",
      description: DESCRIPTION,
      inputSchema: {
        brief: z
          .string()
          .min(1)
          .describe(
            "One-line description of what's being built, e.g. \"a premium " +
              "fintech dashboard\". Drives reference discovery + palette.",
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

        // --- 2. Discover references ----------------------------------------
        const refs = discoverReferences({ description: brief, references }, count);
        if (refs.length === 0) {
          throw new PlumbError(
            "Could not resolve any references for the brief.",
            "Add explicit `references` URLs or broaden the brief wording, then retry.",
          );
        }

        // --- 3. A real build needs the paired plugin -----------------------
        if (!bridge.paired) {
          throw new PlumbError(
            "No Figma plugin is paired.",
            "plumb_brand writes through the plugin path — run the Plumb plugin in Figma and click 'Pair with Plumb'.",
          );
        }

        // --- 4. Screenshot every reference ---------------------------------
        emitStudio({
          kind: "log",
          tool: "plumb_brand",
          screen: "Brand",
          summary: `capturing ${refs.length} reference site(s)…`,
        });
        const { captures, misses } = await captureUrls(
          refs.map((r) => r.url),
          { maxHeight: 2200, settleMs: 1600 },
        );
        for (const cap of captures) {
          emitStudio({
            kind: "log",
            tool: "plumb_brand",
            screen: "Brand",
            summary: `captured ${cap.url} (${cap.width}×${cap.height})`,
          });
        }
        for (const miss of misses) {
          emitStudio({
            kind: "log",
            tool: "plumb_brand",
            screen: "Brand",
            summary: `missed ${miss.url} — ${miss.error}`,
          });
        }

        // --- 5. Synthesize the brand palette, blended across every captured
        // reference (not just the first) — the most-agreed bg/text/accent
        // wins over any single site's quirks.
        const rawPalettes = captures.map((c) => c.palette).filter((p): p is NonNullable<typeof p> => !!p);
        if (rawPalettes.length === 0) {
          throw new PlumbError(
            "No reference screenshot yielded a palette to synthesize a brand from.",
            "Check network access + that Chrome can reach the reference sites (PLUMB_CHROME), then retry.",
          );
        }
        const brand = synthesizeBrandFromMany(rawPalettes);

        // --- 6. Assemble the brand board doc + asset resolver --------------
        const { doc, resolver, assets, foundations } = buildBrandBoard({
          brief: { description: brief },
          references: refs,
          captures,
          brand,
        });

        // --- 6b. Materialise the palette + type scale as REAL Figma tokens
        // (a "Brand" Variable collection + named text styles) — ahead of the
        // geometry pass, matching the blueprint's apply-foundations →
        // apply-design → apply-motion write order. Best-effort: a foundations
        // hiccup shouldn't sink the whole board build.
        let foundationsWarnings: string[] = [];
        try {
          const foundationsResult = await requestApplyFoundations(foundations);
          foundationsWarnings = foundationsResult.warnings;
          emitStudio({
            kind: "log",
            tool: "plumb_brand",
            screen: "Brand",
            summary:
              `foundations: ${foundations.collections[0]?.variables.length ?? 0} colour token(s), ` +
              `${foundations.textStyles.length} text style(s)` +
              (foundationsWarnings.length ? ` — ${foundationsWarnings.length} warning(s)` : ""),
          });
        } catch (e) {
          foundationsWarnings = [`foundations apply failed: ${e instanceof Error ? e.message : String(e)}`];
          emitStudio({
            kind: "log",
            tool: "plumb_brand",
            screen: "Brand",
            summary: `foundations skipped — ${foundationsWarnings[0]}`,
          });
        }

        // --- 7. Compile DSL → PDS, lower PDS → Figma-native EmitPlan --------
        let compiled: CompileResult;
        try {
          compiled = await compile(doc, { assets: resolver });
        } catch (e) {
          throw new PlumbError(
            `Compiling the brand board failed: ${e instanceof Error ? e.message : String(e)}`,
            "This is usually a malformed section/block. Retry, or simplify the brief.",
          );
        }

        const planId = `brand-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const plan = lowerToEmitPlan(compiled.doc, {
          planId,
          target: toEmitTarget({ kind: "page", pageName: "Brand" }),
          mode: "create",
          prune: false,
          reveal: true,
          components: compiled.components,
          assets,
        });

        // --- 8. Build in Figma via the bridge write path -------------------
        const { result, error } = await requestApplyDesign(
          plan,
          (p: ApplyProgressMessage) => {
            emitStudio({
              kind: "log",
              tool: "plumb_brand",
              screen: "Brand",
              summary: `${p.phase} ${p.done}/${p.total}${p.note ? ` — ${p.note}` : ""}`,
            });
          },
        );
        if (error || !result) {
          throw new PlumbError(
            `The plugin could not build the brand board: ${error ?? "no result returned"}`,
            "Check that the plugin is still paired, then retry.",
          );
        }

        emitStudio({
          kind: "screen",
          tool: "plumb_brand",
          screen: "Brand",
          summary: `built brand board — ${captures.length} reference(s), ${result.created} node(s)`,
        });

        // --- 9. Success envelope -------------------------------------------
        return ok({
          references: refs.map((r) => ({ name: r.name, url: r.url })),
          captured: captures.length,
          misses,
          brand,
          rootId: result.rootId,
          foundationsWarnings,
          summary: "built brand board",
        });
      } catch (e) {
        return fail(e);
      }
    },
  );
}
