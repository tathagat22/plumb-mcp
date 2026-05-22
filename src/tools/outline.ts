import { z } from "zod";
import { fetchFileOutline } from "../figma/rest";
import { buildOutline } from "../normalize/outline";
import { fail, ok, requireToken } from "./shared";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

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
        const token = requireToken();
        const file = await fetchFileOutline(args.fileKey, token);
        return ok(
          buildOutline(file.document, {
            key: args.fileKey,
            name: file.fileName,
            version: file.version,
          }),
        );
      } catch (e) {
        return fail(e);
      }
    },
  );
}
