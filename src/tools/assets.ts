import { z } from "zod";
import { resolveScreen, screenName } from "../bridge/inventory";
import { requestAssets } from "../bridge/server";
import { bridge } from "../bridge/store";
import { writeAssets } from "../assets";
import { PlumbError } from "../errors";
import { fail, ok } from "./shared";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

const DESCRIPTION =
  "Export every asset in a Figma screen — icons as SVG, images as PNG — to a " +
  "local folder, and return the file paths. Call this so you build the screen " +
  "with its real assets, not placeholders. Uses the plugin path; needs the " +
  "Plumb plugin paired (check plumb_status).";

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
          .describe("Screen/node id to export assets from."),
        name: z
          .string()
          .optional()
          .describe("Screen name — resolved against the file; duplicates are returned to disambiguate."),
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
        const resolved = resolveScreen(args.id, args.name);
        if ("ambiguous" in resolved) {
          return ok({
            ambiguous: true,
            matches: resolved.ambiguous,
            next: "Several screens share that name. Re-call plumb_assets with one of these `id` values.",
          });
        }

        const { assets, error } = await requestAssets(resolved.id);
        if (error) {
          throw new PlumbError(
            `The plugin could not export assets: ${error}`,
            "Retry; if it persists, the screen may have been deleted or renamed.",
          );
        }

        const { dir, written } = writeAssets(screenName(resolved.id) || resolved.id, assets);
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
          })),
          next: written.length
            ? "Use these file paths when building the screen — match them to PDS nodes by `id`."
            : "No exportable assets (icons/images) were found in this screen.",
        });
      } catch (e) {
        return fail(e);
      }
    },
  );
}
