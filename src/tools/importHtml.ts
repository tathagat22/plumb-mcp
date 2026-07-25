import { z } from "zod";
import { captureHtmlSource, captureHtmlSourceAtViewports } from "../sources/html/capture";
import { buildSemanticGraphFromHtml } from "../semantic/buildFromHtml";
import { PlumbError } from "../errors";
import { runEnrichers } from "../semantic/enricher";
import { RoleEnricher } from "../semantic/enrichers/role";
import { projectWebSpec } from "../semantic/project/web";
import { googleFontsLinkUrl, isKnownGoogleFont } from "../assets/providers/fonts";
import { emitStudio } from "../studio/events";
import { fail, ok } from "./shared";
import type { WebSpecDocument } from "../semantic/project/web";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

const DESCRIPTION =
  "Import a live webpage's structure and semantics — no Figma connection " +
  "needed. Drives headless Chrome to walk the page's visible DOM (skipping " +
  "script/style/hidden elements), maps it onto the same Semantic Graph " +
  "Figma designs use, and returns nodes carrying real CSS values (hex " +
  "colors, literal px) plus a detected `role` (nav/hero/footer/sidebar) " +
  "using the exact same classifier plumb_node's `pattern` field uses. Use " +
  "this to understand an existing site's structure, audit it " +
  "(plumb_audit accepts this shape too), or track it over time " +
  "(plumb_diff two imports of the same URL). Text nodes also carry " +
  "`fontFamily`, and the result carries `fontLinks` — <link> URLs for every " +
  "captured family that matches a known Google Fonts family — so generated " +
  "code doesn't silently fall back to a system font. Pass `viewports` to capture " +
  "the SAME page at multiple sizes in one call (e.g. mobile + desktop) — " +
  "a real responsive layout (a hamburger nav under 768px, a grid that " +
  "collapses to one column) is invisible to a single fixed-size capture.";

const DEFAULT_VIEWPORTS = [
  { label: "mobile", width: 390, height: 844 },
  { label: "tablet", width: 768, height: 1024 },
  { label: "desktop", width: 1440, height: 900 },
];

/** Scans every text node's `fontFamily`, matches against the keyless Google
 *  Fonts manifest (`src/assets/providers/fonts.ts` — the same list the
 *  WRITE/generation path already resolves fonts from), and attaches
 *  dedup'd `<link>` URLs. Without this, an agent generating code from the
 *  captured `fontFamily` alone has no way to actually LOAD that font — the
 *  page would silently render in a fallback. Mutates `doc` in place; a
 *  no-op (no `fontLinks` field at all) when nothing captured matches, so
 *  callers don't have to special-case "no fonts detected." */
function attachFontLinks(doc: WebSpecDocument): void {
  const families = new Set<string>();
  for (const node of Object.values(doc.nodes)) {
    if (node.fontFamily && isKnownGoogleFont(node.fontFamily)) families.add(node.fontFamily);
  }
  if (families.size > 0) doc.fontLinks = [...families].map(googleFontsLinkUrl);
}

/** Shared between the single- and multi-viewport capture paths. */
function describeCaptureError(e: unknown, url: string): PlumbError {
  const message = e instanceof Error ? e.message : String(e);
  if (message.includes("No Chrome found")) {
    return new PlumbError(
      "No Chrome installation found for headless capture.",
      "Set PLUMB_CHROME=/path/to/chrome, or install Google Chrome.",
    );
  }
  return new PlumbError(`Could not load "${url}": ${message}`, "Check the URL is reachable and correct, then retry.");
}

/** Registers the `plumb_import_web` MCP tool. */
export function registerPlumbImportWeb(server: McpServer): void {
  server.registerTool(
    "plumb_import_web",
    {
      title: "Plumb · import web",
      description: DESCRIPTION,
      inputSchema: {
        url: z.string().describe("The page URL to import."),
        selector: z
          .string()
          .optional()
          .describe("CSS selector to root the walk at — omit to walk from document.body."),
        viewports: z
          .union([
            z.literal(true),
            z.array(z.object({ label: z.string(), width: z.number().int().positive(), height: z.number().int().positive() })).min(1),
          ])
          .optional()
          .describe(
            "Capture the same page at multiple sizes in one call. Pass `true` for the " +
              "default set (mobile 390×844, tablet 768×1024, desktop 1440×900), or an " +
              "explicit array of {label, width, height}. Omit for today's single desktop " +
              "capture (unchanged). Returns `{ url, viewports: { <label>: <WebSpecDocument> } }` " +
              "instead of a single flat document when used.",
          ),
      },
      annotations: { readOnlyHint: true, idempotentHint: false, openWorldHint: true },
    },
    async (args) => {
      try {
        const viewportList = args.viewports === true ? DEFAULT_VIEWPORTS : args.viewports;

        if (viewportList) {
          emitStudio({
            kind: "log",
            tool: "plumb_import_web",
            screen: args.url,
            summary: `scanning ${args.url} at ${viewportList.length} viewport(s)…`,
          });
          let captures: Awaited<ReturnType<typeof captureHtmlSourceAtViewports>>;
          try {
            captures = await captureHtmlSourceAtViewports(args.url, viewportList, { rootSelector: args.selector });
          } catch (e) {
            emitStudio({
              kind: "log",
              tool: "plumb_import_web",
              screen: args.url,
              summary: `scan failed — ${e instanceof Error ? e.message : String(e)}`,
            });
            throw describeCaptureError(e, args.url);
          }

          const viewportDocs: Record<string, WebSpecDocument | { error: string; nextAction: string }> = {};
          for (const { label, root } of captures) {
            if (!root) {
              viewportDocs[label] = {
                error: `No visible content captured at "${args.url}" (${label})${args.selector ? ` — selector "${args.selector}"` : ""}.`,
                nextAction: "Check the page actually loads content at this size, or drop `selector` to walk the whole body.",
              };
              emitStudio({
                kind: "log",
                tool: "plumb_import_web",
                screen: args.url,
                summary: `${label}: no visible content captured`,
              });
              continue;
            }
            const graph = buildSemanticGraphFromHtml(root);
            const annotations = runEnrichers(graph, [RoleEnricher]);
            const doc = projectWebSpec(args.url, graph, annotations);
            attachFontLinks(doc);
            viewportDocs[label] = doc;
            emitStudio({
              kind: "log",
              tool: "plumb_import_web",
              screen: args.url,
              summary: `${label}: ${doc.meta.nodeCount} node(s) captured`,
            });
          }
          emitStudio({
            kind: "screen",
            tool: "plumb_import_web",
            screen: args.url,
            summary: `imported ${args.url} — ${viewportList.length} viewport(s)`,
          });
          return ok({ url: args.url, viewports: viewportDocs });
        }

        emitStudio({ kind: "log", tool: "plumb_import_web", screen: args.url, summary: `scanning ${args.url}…` });
        let root;
        try {
          root = await captureHtmlSource(args.url, { rootSelector: args.selector });
        } catch (e) {
          emitStudio({
            kind: "log",
            tool: "plumb_import_web",
            screen: args.url,
            summary: `scan failed — ${e instanceof Error ? e.message : String(e)}`,
          });
          throw describeCaptureError(e, args.url);
        }
        if (!root) {
          throw new PlumbError(
            `No visible content captured at "${args.url}"${args.selector ? ` (selector "${args.selector}")` : ""}.`,
            "Check the page actually loads content there, or drop `selector` to walk the whole body.",
          );
        }

        const graph = buildSemanticGraphFromHtml(root);
        const annotations = runEnrichers(graph, [RoleEnricher]);
        const doc = projectWebSpec(args.url, graph, annotations);
        attachFontLinks(doc);
        emitStudio({
          kind: "screen",
          tool: "plumb_import_web",
          screen: args.url,
          summary: `imported ${args.url} — ${doc.meta.nodeCount} node(s)`,
        });
        return ok(doc);
      } catch (e) {
        return fail(e);
      }
    },
  );
}
