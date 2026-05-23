import { z } from "zod";
import { formatScreenMatches, resolveScreen, screenName } from "../bridge/inventory";
import { requestAssets } from "../bridge/server";
import { bridge } from "../bridge/store";
import { writeAssets } from "../assets";
import { PlumbError } from "../errors";
import { fail, ok } from "./shared";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

const DESCRIPTION =
  "Export Figma assets — icons as SVG, images as PNG — through the paired " +
  "plugin. Three modes:\n" +
  "  • Default — `id` or `name` of a screen → recursive export of every " +
  "asset in it, written to a local folder.\n" +
  "  • List — same + `list: true` → just the manifest (id, name, format, " +
  "parentId) of available assets; no files written. Cheap; use first to see " +
  "what's there.\n" +
  "  • Surgical — `ids: [...]` → export exactly those node ids (one file " +
  "each, no recursion). Preferred once you know what you need.";

/** Registers the `plumb_assets` MCP tool (plan §8). */
export function registerPlumbAssets(server: McpServer): void {
  server.registerTool(
    "plumb_assets",
    {
      title: "Plumb · assets",
      description: DESCRIPTION,
      inputSchema: {
        id: z
          .string()
          .optional()
          .describe("Screen/node id to scope the export to."),
        name: z
          .string()
          .optional()
          .describe("Screen name — resolved against the file."),
        ids: z
          .array(z.string())
          .optional()
          .describe(
            "Surgical — export exactly these node ids (one each, no recursion).",
          ),
        list: z
          .boolean()
          .optional()
          .describe(
            "Manifest only — return id/name/format/parentId per candidate; no file writes.",
          ),
        raw: z
          .boolean()
          .optional()
          .describe(
            "For nodes with IMAGE fills, export the original uploaded bytes (JPG/PNG/GIF/WEBP) via getImageByHash, instead of a 2× rasterised PNG render. Other nodes (icons, vectors) export the same as default.",
          ),
        inline: z
          .boolean()
          .optional()
          .describe(
            "Return asset bytes inline on each row: SVGs as raw markup, " +
              "bitmaps under 64KB as a data: URI. Useful for dropping SVG " +
              "icons straight into JSX without re-reading from disk. Files " +
              "are still written; this is additive.",
          ),
      },
      annotations: { readOnlyHint: false, idempotentHint: true, openWorldHint: false },
    },
    async (args) => {
      try {
        if (!bridge.paired) {
          throw new PlumbError(
            "No Figma plugin is paired.",
            "plumb_assets uses the plugin path — run the Plumb plugin in Figma and click 'Pair with Plumb'.",
          );
        }

        const list = args.list === true;
        const raw = args.raw === true;
        const inline = args.inline === true;

        // --- Surgical mode — specific ids ----------------------------------
        if (args.ids && args.ids.length > 0) {
          const { assets, error } = await requestAssets({ ids: args.ids, list, raw });
          if (error) {
            throw new PlumbError(
              `The plugin could not export the requested ids: ${error}`,
              "Retry; if it persists, the ids may be invalid or deleted.",
            );
          }
          if (list) {
            return ok({
              source: "plugin",
              mode: "list",
              count: assets.length,
              manifest: assets.map((a) => ({
                id: a.id,
                name: a.name,
                format: a.format,
                parentId: a.parentId,
              })),
              next:
                assets.length === 0
                  ? "None of the supplied ids resolved to exportable nodes."
                  : "Pick what you need, then call plumb_assets with `ids: [...]` and no `list`.",
            });
          }
          const folder = args.name || (args.id ? screenName(args.id) : "") || "specific";
          const { dir, written } = writeAssets(folder, assets, { inline });
          return ok({
            source: "plugin",
            mode: "specific",
            dir,
            count: written.length,
            assets: written.map((w) => ({
              id: w.id,
              name: w.name,
              format: w.format,
              path: w.path,
              bytes: w.bytes,
              parentId: w.parentId,
              ...(w.source !== undefined ? { source: w.source } : {}),
            })),
            next:
              written.length === 0
                ? "None of the supplied ids resolved to exportable nodes."
                : inline
                  ? "Each row has either `source` (SVG markup or data: URI) or just `path`. Drop SVG `source` straight into JSX."
                  : "Use these file paths when building.",
          });
        }

        // --- Screen-scoped modes (default or list) -------------------------
        if (!args.id && !args.name) {
          throw new PlumbError(
            "Provide a screen `id` or `name` — or `ids: [...]` for surgical export.",
            "Call plumb_outline to list screen names and ids.",
          );
        }

        const resolved = resolveScreen(args.id, args.name);
        if ("ambiguous" in resolved) {
          return ok({
            ambiguous: true,
            matches: formatScreenMatches(resolved.ambiguous),
            next:
              "Several screens share that name. Each row shows `page` and " +
              "`box` (w×h) — pick the one you want and re-call plumb_assets with its `id`.",
          });
        }

        const { assets, error } = await requestAssets({ nodeId: resolved.id, list, raw });
        if (error) {
          throw new PlumbError(
            `The plugin could not export assets: ${error}`,
            "Retry; if it persists, the screen may have been deleted or renamed.",
          );
        }

        const sname = screenName(resolved.id) || resolved.id;

        if (list) {
          return ok({
            source: "plugin",
            mode: "list",
            screen: sname,
            count: assets.length,
            manifest: assets.map((a) => ({
              id: a.id,
              name: a.name,
              format: a.format,
              parentId: a.parentId,
            })),
            next:
              assets.length === 0
                ? "No exportable assets in this screen."
                : "Pick the ones you actually need, then call plumb_assets with `ids: [...]` (no `list`).",
          });
        }

        const { dir, written } = writeAssets(sname, assets, { inline });
        return ok({
          source: "plugin",
          dir,
          count: written.length,
          assets: written.map((w) => ({
            id: w.id,
            name: w.name,
            format: w.format,
            path: w.path,
            bytes: w.bytes,
            parentId: w.parentId,
            ...(w.source !== undefined ? { source: w.source } : {}),
          })),
          next:
            written.length === 0
              ? "No exportable assets (icons / images) were found in this screen."
              : inline
                ? "Each row has either `source` (SVG markup or data: URI) or just `path`. Drop SVG `source` straight into JSX."
                : "Use these file paths when building. Tip: pass `list: true` first to peek without downloading; then `ids: [...]` to pull just what you need.",
        });
      } catch (e) {
        return fail(e);
      }
    },
  );
}
