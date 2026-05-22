import { z } from "zod";
import { cacheGet, cacheSet, DEFAULT_TTL_MS } from "../cache";
import { pluginOutline } from "../bridge/inventory";
import { bridge } from "../bridge/store";
import { PlumbError } from "../errors";
import { fetchFileOutline } from "../figma/rest";
import { buildOutline } from "../normalize/outline";
import { fail, ok, requireToken } from "./shared";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { OutlineDocument } from "../normalize/outline";

const DESCRIPTION =
  "Map a Figma file cheaply: its pages and their top-level screens (id, name, " +
  "size). The shallow entry point — call it to find the screen you want, then " +
  "call plumb_node with that screen's id (or name) to extract it. With the " +
  "Plumb plugin paired, no file key is needed.";

/** Registers the `plumb_outline` MCP tool (plan §8). */
export function registerPlumbOutline(server: McpServer): void {
  server.registerTool(
    "plumb_outline",
    {
      title: "Plumb · outline",
      description: DESCRIPTION,
      inputSchema: {
        fileKey: z
          .string()
          .optional()
          .describe("Figma file key — for the REST path. Omit when the Plumb plugin is paired."),
      },
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
    },
    async (args) => {
      try {
        // Plugin path — the live inventory, no file key.
        if (bridge.paired && bridge.inventory) {
          return ok(pluginOutline());
        }

        // REST path.
        if (!args.fileKey) {
          throw new PlumbError(
            "plumb_outline needs the Plumb plugin paired, or a fileKey for the REST path.",
            "Pair the Plumb plugin in Figma, or pass a fileKey.",
          );
        }
        const cacheKey = `outline:${args.fileKey}`;
        const hit = cacheGet<OutlineDocument>(cacheKey, DEFAULT_TTL_MS);
        if (hit) return ok({ ...hit.payload, cached: true });

        const token = requireToken();
        const file = await fetchFileOutline(args.fileKey, token);
        const outline = buildOutline(file.document, {
          key: args.fileKey,
          name: file.fileName,
          version: file.version,
        });
        cacheSet(cacheKey, file.version, outline);
        return ok({ ...outline, cached: false });
      } catch (e) {
        return fail(e);
      }
    },
  );
}
