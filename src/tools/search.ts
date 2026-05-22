import { z } from "zod";
import { requestSearch } from "../bridge/server";
import { bridge } from "../bridge/store";
import { PlumbError } from "../errors";
import { fail, ok } from "./shared";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

const DESCRIPTION =
  "Find nodes across the file by name and/or type — 'where is the primary " +
  "button?', 'every TEXT layer named Title', etc. Returns matches with id, " +
  "name, type, page, and size. Drill into one with plumb_node, or pull its " +
  "asset with plumb_assets. Plugin path; needs the Plumb plugin paired.";

/** Registers the `plumb_search` MCP tool (plan §8). */
export function registerPlumbSearch(server: McpServer): void {
  server.registerTool(
    "plumb_search",
    {
      title: "Plumb · search",
      description: DESCRIPTION,
      inputSchema: {
        query: z
          .string()
          .optional()
          .describe("Substring match on node name (case-insensitive)."),
        type: z
          .string()
          .optional()
          .describe('Filter by node type, e.g. "TEXT", "FRAME", "INSTANCE", "VECTOR".'),
      },
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
    },
    async (args) => {
      try {
        if (!bridge.paired) {
          throw new PlumbError(
            "No Figma plugin is paired.",
            "plumb_search uses the plugin path — run the Plumb plugin in Figma and click 'Pair with Plumb'.",
          );
        }
        if (!args.query && !args.type) {
          throw new PlumbError(
            "Provide a `query` or a `type`.",
            'e.g. plumb_search({ query: "button" }) or plumb_search({ type: "TEXT" }).',
          );
        }
        const { matches, error } = await requestSearch(args.query, args.type);
        if (error) {
          throw new PlumbError(
            `The plugin could not search: ${error}`,
            "Retry; if it persists, re-run the Plumb plugin in Figma.",
          );
        }
        return ok({
          source: "plugin",
          count: matches.length,
          matches,
          next: matches.length
            ? "Drill into one with plumb_node({ id }) or pull its asset with plumb_assets({ ids: [id] })."
            : "No matches. Try a different query or type.",
        });
      } catch (e) {
        return fail(e);
      }
    },
  );
}
