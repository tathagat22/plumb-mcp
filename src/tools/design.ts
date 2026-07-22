import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { compile } from "../dsl/compile";
import { DesignDocSchema } from "../dsl/schema";
import { lowerToEmitPlan } from "../emit/plan";
import { requestApplyDesign, stageInboundAsset } from "../bridge/server";
import { resolveAsset } from "../assets/search";
import { bridge } from "../bridge/store";
import { PlumbError } from "../errors";
import { assertStructureBounds } from "../util/bounds";
import { emitStudio } from "../studio/events";
import { fail, ok } from "./shared";
import type { CompileContext, CompileResult } from "../dsl/compile";
import type { LowerAssetInfo } from "../emit/plan";
import type { SourcedAsset } from "../assets/search";
import type {
  AssetResolver,
  DesignDoc,
  ResolvedAsset,
} from "../dsl/schema";
import type {
  ApplyProgressMessage,
  EmitResult,
  EmitTarget,
  EmitWarning,
} from "../bridge/protocol";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

const DESCRIPTION =
  "Author a design from a high-level Plumb Design DSL document and BUILD it " +
  "into the paired Figma file. This is the write direction: the DSL " +
  "(semantic pages → sections → blocks + brand tokens) is validated, compiled " +
  "DOWN to the PDS IR, lowered to a Figma-native emit plan, and executed by " +
  "the plugin (auto-layout frames, text, images, icons). Returns the created " +
  "node ids keyed by authored element handle — the join key you then feed to " +
  "plumb_review / motion. Pass a `brief` to record intent (audience, tone, " +
  "brand) alongside the build. Use `dryRun: true` to compile + validate " +
  "without touching Figma.";

/** Design-brief intake. A lightweight, self-contained normalization of author
 *  intent that rides alongside the build. The canonical, richer brief model
 *  (deriveBrief → foundations synthesis) lives in src/design/brief.ts; this
 *  intake surface stays minimal so the write tool never hard-depends on the
 *  foundations subsystem. */
const BriefSchema = z
  .object({
    name: z.string().optional().describe("Product / project name."),
    description: z
      .string()
      .optional()
      .describe("One-line description of what is being built."),
    audience: z.string().optional().describe("Who it's for."),
    tone: z
      .array(z.string())
      .optional()
      .describe('Voice adjectives, e.g. ["confident","playful"].'),
    industry: z.string().optional().describe("Domain / vertical."),
    keywords: z.array(z.string()).optional().describe("Guiding keywords."),
    references: z
      .array(z.string())
      .optional()
      .describe("Reference sites / inspirations."),
    brandColors: z
      .array(z.string())
      .optional()
      .describe("Seed brand hexes, if the caller has them."),
    mustHave: z.array(z.string()).optional().describe("Non-negotiables."),
    avoid: z.array(z.string()).optional().describe("Things to steer clear of."),
  })
  .strict();

type DesignBriefInput = z.infer<typeof BriefSchema>;

const TargetSchema = z
  .object({
    kind: z
      .enum(["page", "into", "replace"])
      .describe(
        "`page` — new top-level frame on a Figma page; `into` — append inside " +
          "an existing node; `replace` — swap an existing node in place.",
      ),
    nodeId: z
      .string()
      .optional()
      .describe("Target node id (required for `into` / `replace`)."),
    pageName: z
      .string()
      .optional()
      .describe("Figma page to place onto (`page` kind only)."),
    pos: z
      .object({ x: z.number(), y: z.number() })
      .optional()
      .describe("Canvas position for the new root (`page` kind only)."),
  })
  .strict();

type TargetInput = z.infer<typeof TargetSchema>;

/** Project a SourcedAsset (bytes-carrying) down to the compiler's byte-free
 *  ResolvedAsset shape, optionally overriding the assetId. */
function toResolved(r: SourcedAsset, assetId?: string): ResolvedAsset {
  return {
    assetId: assetId ?? r.assetId,
    inlineSvg: r.inlineSvg,
    vectorPath: r.vectorPath,
    url: r.url,
    w: r.w,
    h: r.h,
    kind: r.kind,
    scaleMode: r.scaleMode,
  };
}

/**
 * Provider-backed asset resolver that also STAGES bytes for the plugin to pull.
 * `resolveAsset` never throws (it falls back to a deterministic placeholder), so
 * this keeps the write path robust offline. SVGs (icons/illustrations) travel
 * inline; raster bytes (photos) are staged via {@link stageInboundAsset} and the
 * staged key BECOMES the assetId so the lowered `EmitAsset.ref` equals the
 * `GET /asset/<key>` the plugin UI fetches. The returned `assets` map is handed
 * to `lowerToEmitPlan` as `opts.assets` so image/svg fills actually ship.
 */
function makeSourcingResolver(): {
  resolver: AssetResolver;
  assets: Record<string, LowerAssetInfo>;
  warnings: string[];
} {
  const assets: Record<string, LowerAssetInfo> = {};
  const warnings: string[] = [];
  const resolver: AssetResolver = {
    async resolve(spec): Promise<ResolvedAsset> {
      const r: SourcedAsset = await resolveAsset(spec);
      if (spec.kind === "photo" && (r.placeholder || r.provider === "picsum")) {
        warnings.push(
          `asset "${spec.query ?? spec.kind}": no photo API key set — used a random placeholder. ` +
            `Set UNSPLASH_ACCESS_KEY / PEXELS_API_KEY / PIXABAY_API_KEY (all free) for on-brief imagery.`,
        );
      }
      if (r.inlineSvg) {
        const id = r.assetId ?? `svg${Object.keys(assets).length}`;
        assets[id] = { ext: "svg", kind: "svg", svgInline: r.inlineSvg, w: r.w, h: r.h };
        return toResolved(r, id);
      }
      if (r.bytes && r.bytes.length) {
        const ext = r.ext ?? "png";
        const key = stageInboundAsset(r.bytes, ext);
        assets[key] = { ext, kind: "image", w: r.w, h: r.h };
        return toResolved(r, key);
      }
      // No bytes / no inline SVG (url-only or unresolved) → metadata only; emit
      // renders an empty fill + warns rather than crashing.
      return toResolved(r);
    },
  };
  return { resolver, assets, warnings };
}

/** Flatten a zod issue list into a single human-readable string. */
function formatIssues(err: z.ZodError): string {
  return err.issues
    .slice(0, 8)
    .map((i) => {
      const path = i.path.join(".") || "(root)";
      return `${path}: ${i.message}`;
    })
    .join("; ");
}

/** Map the tool's target input to the wire {@link EmitTarget}. */
function toEmitTarget(t: TargetInput | undefined): EmitTarget {
  if (!t || t.kind === "page") {
    return { kind: "page", pos: t?.pos, pageName: t?.pageName };
  }
  if (!t.nodeId) {
    throw new PlumbError(
      `target.kind "${t.kind}" requires a target.nodeId.`,
      "Pass the Figma node id to build into / replace, or use target.kind \"page\".",
    );
  }
  return t.kind === "into"
    ? { kind: "into", nodeId: t.nodeId }
    : { kind: "replace", nodeId: t.nodeId };
}

/** Fold brief intent into the doc's meta when the doc didn't supply its own. */
function applyBrief(doc: DesignDoc, brief: DesignBriefInput | undefined): void {
  if (!brief) return;
  const meta = doc.meta ?? {};
  if (!meta.name && brief.name) meta.name = brief.name;
  if (!meta.description && brief.description) meta.description = brief.description;
  doc.meta = meta;
}

/** Registers the `plumb_design` MCP write tool (blueprint §9 write-tool). */
export function registerPlumbDesign(server: McpServer): void {
  server.registerTool(
    "plumb_design",
    {
      title: "Plumb · design (build)",
      description: DESCRIPTION,
      inputSchema: {
        doc: z
          .unknown()
          .describe(
            "A Plumb Design DSL document (version \"1\": brand + pages of " +
              "semantic sections). Validated against DesignDocSchema.",
          ),
        brief: BriefSchema.optional().describe(
          "Optional design-brief intake — records author intent alongside the build.",
        ),
        target: TargetSchema.optional().describe(
          "Where to build. Defaults to a new top-level frame on the current page.",
        ),
        mode: z
          .enum(["create", "sync"])
          .optional()
          .describe(
            "`create` (default) — fresh nodes. `sync` — idempotent re-apply " +
              "keyed on stable plumbKey (authored element handle); pair with " +
              "`prune` to delete stale nodes.",
          ),
        prune: z
          .boolean()
          .optional()
          .describe("sync only — delete built nodes no longer in the design."),
        reveal: z
          .boolean()
          .optional()
          .describe("Scroll + select the built root in Figma when done."),
        pageWidth: z
          .number()
          .int()
          .positive()
          .optional()
          .describe("Layout width hint for pages that don't set their own."),
        dryRun: z
          .boolean()
          .optional()
          .describe(
            "Compile + lower only; do NOT touch Figma. Returns plan stats + " +
              "warnings so you can sanity-check before building.",
          ),
      },
      annotations: { readOnlyHint: false, idempotentHint: false, openWorldHint: false },
    },
    async (args) => {
      try {
        const dryRun = args.dryRun === true;

        // Some MCP clients JSON-stringify untyped object params — accept either a
        // parsed object or a JSON string for `doc` / `brief`.
        const asObject = (v: unknown): unknown => {
          if (typeof v !== "string") return v;
          try {
            return JSON.parse(v);
          } catch {
            return v; // leave as-is → schema validation reports the real problem
          }
        };

        // --- Validate the DSL document -------------------------------------
        // Bounds check BEFORE zod's recursive `z.lazy(() => BlockSchema)`
        // touches this — a pathologically deep/huge object must fail fast
        // with a clear message here, not risk zod's own recursive parser
        // blowing the call stack on untrusted input.
        const rawDoc = asObject(args.doc);
        try {
          assertStructureBounds(rawDoc);
        } catch (e) {
          throw new PlumbError(
            `The design document is too large/deeply nested to validate: ${e instanceof Error ? e.message : String(e)}`,
            "Simplify the DSL (flatter nesting, fewer blocks) and retry.",
          );
        }
        const parsed = DesignDocSchema.safeParse(rawDoc);
        if (!parsed.success) {
          throw new PlumbError(
            `The design document failed validation: ${formatIssues(parsed.error)}`,
            "Fix the DSL to match DesignDocSchema (version \"1\", brand, pages[]) and retry.",
          );
        }
        const doc = parsed.data;

        // --- Design-brief intake -------------------------------------------
        const briefParsed = args.brief
          ? BriefSchema.safeParse(asObject(args.brief))
          : undefined;
        if (briefParsed && !briefParsed.success) {
          throw new PlumbError(
            `The brief failed validation: ${formatIssues(briefParsed.error)}`,
            "Adjust the brief fields (all optional strings / string arrays) and retry.",
          );
        }
        const brief = briefParsed?.data;
        applyBrief(doc, brief);

        // A real build needs the paired plugin; a dryRun does not.
        if (!dryRun && !bridge.paired) {
          throw new PlumbError(
            "No Figma plugin is paired.",
            "plumb_design writes through the plugin path — run the Plumb plugin in Figma and click 'Pair with Plumb'.",
          );
        }

        // --- Compile DSL → PDS IR ------------------------------------------
        // Provider-backed resolver stages bytes as a side effect; `sourced.assets`
        // is populated during compile() and fed to the lowerer below.
        const sourced = makeSourcingResolver();
        const ctx: CompileContext = {
          assets: sourced.resolver,
          page: args.pageWidth ? { width: args.pageWidth } : undefined,
        };
        let compiled: CompileResult;
        try {
          compiled = await compile(doc, ctx);
        } catch (e) {
          throw new PlumbError(
            `Compiling the design failed: ${e instanceof Error ? e.message : String(e)}`,
            "This is usually a malformed section/block. Simplify the offending page and retry.",
          );
        }

        // --- Lower PDS → Figma-native EmitPlan -----------------------------
        const target = toEmitTarget(args.target);
        const mode = args.mode ?? "create";
        const planId = `plan-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const plan = lowerToEmitPlan(compiled.doc, {
          planId,
          target,
          mode,
          prune: args.prune === true,
          reveal: args.reveal === true,
          components: compiled.components,
          assets: sourced.assets,
        });

        const pageCount = doc.pages.length;
        const opCount = plan.ops.length;
        const assetCount = plan.assets?.length ?? 0;

        // --- dryRun short-circuit: compiled but not built ------------------
        if (dryRun) {
          emitStudio({
            kind: "log",
            tool: "plumb_design",
            screen: doc.meta?.name ?? null,
            summary: `dry-run compiled ${pageCount} page(s) → ${opCount} node(s)`,
          });
          return ok({
            dryRun: true,
            planId,
            pages: pageCount,
            nodes: opCount,
            assets: assetCount,
            fonts: plan.fonts.length,
            warnings: compiled.warnings,
            next:
              "Compile succeeded. Re-run without `dryRun` (plugin paired) to build it in Figma.",
          });
        }

        // --- Build in Figma via the bridge write path ----------------------
        const { result, error } = await requestApplyDesign(
          plan,
          (p: ApplyProgressMessage) => {
            emitStudio({
              kind: "log",
              tool: "plumb_design",
              screen: doc.meta?.name ?? null,
              summary: `${p.phase} ${p.done}/${p.total}${p.note ? ` — ${p.note}` : ""}`,
            });
          },
        );

        if (error || !result) {
          throw new PlumbError(
            `The plugin could not build the design: ${error ?? "no result returned"}`,
            "Check that the plugin is still paired and the target node exists, then retry.",
          );
        }

        return finish(doc, compiled, result, planId, sourced.warnings);
      } catch (e) {
        return fail(e);
      }
    },
  );
}

/** Assemble the success envelope: created ids + warnings + a human summary. */
function finish(
  doc: DesignDoc,
  compiled: CompileResult,
  result: EmitResult,
  planId: string,
  assetWarnings: string[] = [],
) {
  const warnings = [
    ...new Set(assetWarnings),
    ...compiled.warnings,
    ...result.warnings.map((w: EmitWarning) => `${w.key}.${w.field}: ${w.message}`),
  ];
  const summary =
    `built "${doc.meta?.name ?? "design"}" — ${result.created} created, ` +
    `${result.updated} updated, ${result.deleted} deleted`;

  emitStudio({
    kind: "screen",
    tool: "plumb_design",
    screen: doc.meta?.name ?? null,
    summary,
  });

  // Persist the authored PDS so plumb_review can diff built-vs-authored. Written
  // to a stable temp path keyed by planId; non-fatal if the write fails.
  let authoredPath: string | undefined;
  try {
    authoredPath = join(tmpdir(), `plumb-authored-${planId}.json`);
    writeFileSync(authoredPath, JSON.stringify(compiled.doc));
  } catch {
    authoredPath = undefined;
  }

  return ok({
    source: "plugin",
    planId,
    rootId: result.rootId,
    rootKey: result.rootKey,
    created: result.created,
    updated: result.updated,
    deleted: result.deleted,
    // authored element handle (el / plumbKey) → Figma node id. The join key
    // for plumb_review (elMap) and motion wiring.
    ids: result.ids,
    // Path to the authored PdsDocument — pass to plumb_review as authoredPath.
    authoredPath,
    warnings,
    summary,
    next:
      "Built. Run plumb_review with { id: rootId, ids, authoredPath } to score built-vs-authored and get the fix list.",
  });
}
