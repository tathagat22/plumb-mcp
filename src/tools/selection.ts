import { z } from "zod";
import { requestSelection } from "../bridge/server";
import { bridge } from "../bridge/store";
import { PlumbError } from "../errors";
import { normalizeToBudget } from "../normalize/budget";
import { fail, ok } from "./shared";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { FigmaFileResult } from "../figma/types";

const DESCRIPTION =
  "Extract whatever the user currently has selected in Figma, via the paired " +
  "Plumb plugin — no file key, no token, no rate limit. Returns the same " +
  "compact PDS as plumb_node. Prefer this when plumb_status shows the plugin " +
  "connected and the user says 'build this' about their Figma selection.";

/** Registers the `plumb_selection` MCP tool — the plugin-path workhorse. */
export function registerPlumbSelection(server: McpServer): void {
  server.registerTool(
    "plumb_selection",
    {
      title: "Plumb · selection",
      description: DESCRIPTION,
      inputSchema: {
        depth: z
          .number()
          .int()
          .min(1)
          .max(12)
          .optional()
          .describe("Levels to disclose. Default 3."),
        notes: z
          .boolean()
          .optional()
          .describe("Include human-readable notes per node."),
        maxTokens: z
          .number()
          .int()
          .positive()
          .optional()
          .describe("Soft token budget; fit-to-budget reduces depth to fit."),
      },
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
    },
    async (args) => {
      try {
        if (!bridge.paired) {
          throw new PlumbError(
            "No Figma plugin is paired.",
            "Open your file in Figma, run the Plumb plugin, and click " +
              "'Pair with Plumb' in its panel.",
          );
        }
        if (!bridge.selection) {
          throw new PlumbError(
            "The Plumb plugin is paired, but nothing is selected in Figma.",
            "Select a frame in Figma — the plugin reports it as soon as you do.",
          );
        }
        const depth = args.depth ?? 3;
        const { doc, nodeName } = await requestSelection();
        if (!doc) {
          throw new PlumbError(
            "Nothing is selected in Figma anymore.",
            "Select a frame in Figma, then call plumb_selection again.",
          );
        }
        const file: FigmaFileResult = {
          document: doc,
          fileName: bridge.selection.fileName,
          version: `plugin-${Date.now()}`,
        };
        const pds = normalizeToBudget(file, depth, args.maxTokens, {
          notes: args.notes,
        });
        return ok({ ...pds, source: "plugin", selection: nodeName ?? bridge.selection.nodeName });
      } catch (e) {
        return fail(e);
      }
    },
  );
}
