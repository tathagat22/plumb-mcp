import { z } from "zod";
import { fetchNodeViaRest } from "../figma/rest";
import { normalize } from "../normalize/normalize";
import { fail, ok, requireToken } from "./shared";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

const DESCRIPTION =
  "Extract a Figma node as a compact, normalized Plumb Design Spec (PDS): " +
  "deduplicated design tokens plus a CSS-shaped node tree, built for an AI " +
  "agent to implement UI cheaply and accurately. Auto-layout is pre-resolved " +
  "to flexbox; styles are deduped into a token table; invisible nodes and " +
  "default noise are pruned. Call this whenever you are given a Figma frame " +
  "or node-id to build. Milestone 0: reads via the Figma REST API — the " +
  "server needs FIGMA_TOKEN set, and you pass the file key.";

/** Registers the `plumb_node` MCP tool (plan §8). */
export function registerPlumbNode(server: McpServer): void {
  server.registerTool(
    "plumb_node",
    {
      title: "Plumb · node",
      description: DESCRIPTION,
      inputSchema: {
        fileKey: z
          .string()
          .describe("Figma file key — the string after /design/ or /file/ in the Figma URL."),
        id: z
          .string()
          .describe('Node id to extract, e.g. "131:6950" (use ":" not "-").'),
        depth: z
          .number()
          .int()
          .min(1)
          .max(12)
          .optional()
          .describe("How many levels deep to extract. Default 3."),
        notes: z
          .boolean()
          .optional()
          .describe("Include human-readable notes per node (off by default to save tokens)."),
        maxTokens: z
          .number()
          .int()
          .positive()
          .optional()
          .describe("Soft token budget; the response sets meta.truncated if it exceeds this."),
      },
      annotations: {
        readOnlyHint: true,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (args) => {
      try {
        const token = requireToken();
        const depth = args.depth ?? 3;
        // Fetch one level deeper than we disclose, so boundary nodes get an
        // accurate `more` child count.
        const file = await fetchNodeViaRest({
          fileKey: args.fileKey,
          nodeId: args.id,
          depth: depth + 1,
          token,
        });
        const pds = normalize(file, depth, {
          notes: args.notes,
          maxTokens: args.maxTokens,
        });
        return ok(pds);
      } catch (e) {
        return fail(e);
      }
    },
  );
}
