/**
 * plumb_scan_references — the concrete "watch it scan references" step
 * (docs/ROADMAP-v0.14-design-intelligence.md's Track 2 D2). Given a set of
 * reference URLs, scans each LIVE (structure, not just a screenshot) using
 * the same pipeline `plumb_import_web` uses, streams progress to Studio
 * (D1), and returns a per-role STYLE DIGEST — concrete exemplars for
 * whatever nav/hero/footer/card sections each reference actually has, not
 * just a flat colour palette (`plumb_brand`'s job).
 *
 * Deliberately does NOT itself compose a design from these patterns —
 * `plumb_studio`'s section composer (`src/studio/compose.ts`) is a
 * carefully-tuned system of its own, and blending "an observed hero is
 * usually ~560px tall, centered, with a 48-64px headline" into its
 * generation logic is real design work, not a one-line wire-up. This tool
 * does the honest, well-scoped half: turn live references into structured
 * data an agent (or a future generation step) can actually reason about —
 * scoped to nav/hero/footer/card exemplars, per the roadmap's own call to
 * keep v1 bounded rather than attempting full-page pattern transplantation.
 */
import { z } from "zod";
import { captureHtmlSource } from "../sources/html/capture";
import { buildSemanticGraphFromHtml } from "../semantic/buildFromHtml";
import { runEnrichers } from "../semantic/enricher";
import { RoleEnricher } from "../semantic/enrichers/role";
import { projectWebSpec } from "../semantic/project/web";
import { emitStudio } from "../studio/events";
import { fail, ok } from "./shared";
import type { WebNode } from "../semantic/project/web";
import type { PdsLayout } from "../pds";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

const DESCRIPTION =
  "Scan N live reference URLs and extract a per-role STYLE DIGEST — concrete " +
  "nav/hero/footer/card exemplars (box size, layout, colour, type size/family, " +
  "alignment) from each reference that actually has one, using the same " +
  "structural pipeline plumb_import_web uses. Streams live progress to Plumb " +
  "Studio as each reference is scanned. Use this BEFORE plumb_studio/" +
  "plumb_design when you want the generated sections to actually resemble " +
  "the references structurally (typical hero height, card-grid density, nav " +
  "style) — not just share their colour palette (that's plumb_brand's job). " +
  "Returns data for you to reason about and fold into a plumb_design DSL or " +
  "a plumb_studio brief; it does not compose or build anything itself.";

const MAX_REFERENCES = 8;
/** How many descendant levels under a role node to scan for text sizing —
 *  mirrors RoleEnricher's own TEXT_SCAN_DEPTH so "headline size" means the
 *  same thing here as it does during classification. */
const TEXT_SCAN_DEPTH = 3;

export interface RoleExemplar {
  url: string;
  box: { w: number; h: number };
  layout?: PdsLayout;
  fillColor?: string;
  /** Every distinct text size (px) found within the section, up to
   *  TEXT_SCAN_DEPTH levels down — e.g. a hero's [48, 18] is "a 48px
   *  headline over 18px body copy," genuinely informative; a single
   *  number would hide that shape. */
  textSizes: number[];
  textAlign?: string;
  fontFamily?: string;
}

export function textSizesUnder(nodeId: string, nodes: Record<string, WebNode>, depth: number): number[] {
  const node = nodes[nodeId];
  if (!node) return [];
  const sizes = new Set<number>();
  if (node.textPx) sizes.add(node.textPx);
  if (depth > 0) {
    for (const childId of node.children ?? []) {
      for (const s of textSizesUnder(childId, nodes, depth - 1)) sizes.add(s);
    }
  }
  return [...sizes].sort((a, b) => b - a);
}

export function exemplarFor(url: string, node: WebNode, nodes: Record<string, WebNode>): RoleExemplar {
  return {
    url,
    box: node.box,
    layout: node.layout,
    fillColor: node.fillColor,
    textSizes: textSizesUnder(node.id, nodes, TEXT_SCAN_DEPTH),
    textAlign: node.textAlign,
    fontFamily: node.fontFamily,
  };
}

/** Registers the `plumb_scan_references` MCP tool. */
export function registerPlumbScanReferences(server: McpServer): void {
  server.registerTool(
    "plumb_scan_references",
    {
      title: "Plumb · scan references",
      description: DESCRIPTION,
      inputSchema: {
        references: z
          .array(z.string())
          .min(1)
          .max(MAX_REFERENCES)
          .describe(`Reference URLs to scan live, up to ${MAX_REFERENCES}.`),
      },
      annotations: { readOnlyHint: true, idempotentHint: false, openWorldHint: true },
    },
    async (args) => {
      try {
        emitStudio({
          kind: "log",
          tool: "plumb_scan_references",
          summary: `scanning ${args.references.length} reference(s)…`,
        });

        const patterns: Record<"nav" | "hero" | "footer" | "card", RoleExemplar[]> = {
          nav: [],
          hero: [],
          footer: [],
          card: [],
        };
        const misses: { url: string; error: string }[] = [];

        for (const url of args.references) {
          try {
            const root = await captureHtmlSource(url, {});
            if (!root) {
              misses.push({ url, error: "no visible content captured" });
              emitStudio({ kind: "log", tool: "plumb_scan_references", screen: url, summary: `${url}: no visible content` });
              continue;
            }
            const graph = buildSemanticGraphFromHtml(root);
            const annotations = runEnrichers(graph, [RoleEnricher]);
            const doc = projectWebSpec(url, graph, annotations);

            let found = 0;
            for (const node of Object.values(doc.nodes)) {
              if (node.role === "nav" || node.role === "hero" || node.role === "footer" || node.role === "card") {
                patterns[node.role].push(exemplarFor(url, node, doc.nodes));
                found++;
              }
            }
            emitStudio({
              kind: "screen",
              tool: "plumb_scan_references",
              screen: url,
              summary: `${url}: ${found} section(s) matched (of ${doc.meta.nodeCount} node(s))`,
            });
          } catch (e) {
            const message = e instanceof Error ? e.message : String(e);
            misses.push({ url, error: message });
            emitStudio({ kind: "log", tool: "plumb_scan_references", screen: url, summary: `${url}: failed — ${message}` });
          }
        }

        emitStudio({
          kind: "screen",
          tool: "plumb_scan_references",
          summary: `scanned ${args.references.length - misses.length}/${args.references.length} reference(s)`,
        });

        const matchedCount = Object.values(patterns).reduce((n, list) => n + list.length, 0);
        return ok({
          references: args.references,
          patterns,
          misses,
          next:
            matchedCount > 0
              ? "Read `patterns.<role>` for concrete exemplars (box size, layout, colour, textSizes) " +
                "from whichever references actually had that section. Use them as concrete targets " +
                "when authoring a plumb_design DSL (e.g. match the typical hero height/layout and " +
                "headline size) or fold a summary into a plumb_studio brief — this tool only scans " +
                "and reports, it doesn't compose or build."
              : "No nav/hero/footer/card sections were confidently classified on any reference — " +
                "try different URLs, or use plumb_import_web directly on one to inspect its raw structure.",
        });
      } catch (e) {
        return fail(e);
      }
    },
  );
}
