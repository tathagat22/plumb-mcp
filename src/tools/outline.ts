import { z } from "zod";
import { cacheGet, cacheSet, DEFAULT_TTL_MS } from "../cache";
import { fetchFileOutline } from "../figma/rest";
import { buildOutline } from "../normalize/outline";
import { fail, ok, requireToken } from "./shared";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { OutlineDocument } from "../normalize/outline";

const DESCRIPTION =
  "Map a Figma file cheaply: its pages and their top-level frames (id, name, " +
  "type, size). The shallow entry point — call it to find the frame you want, " +
  "then call plumb_node with that frame's id to extract it.";

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
          .describe("Figma file key — the string after /design/ or /file/ in the URL."),
      },
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
    },
    async (args) => {
      try {
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
