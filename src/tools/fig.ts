import { z } from "zod";
import { existsSync } from "node:fs";
import { extname } from "node:path";
import { figNodeById, loadFig } from "../fig/parser";
import { PlumbError } from "../errors";
import { fail, ok } from "./shared";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

/** These tools are a generic "read any file the caller names" primitive
 *  unless scoped to the one file type they're documented to read. */
function assertFigPath(figPath: string): void {
  if (extname(figPath).toLowerCase() !== ".fig") {
    throw new PlumbError(
      `"${figPath}" doesn't look like a .fig file.`,
      "Pass the path to a .fig file exported from Figma desktop (File → Save local copy).",
    );
  }
}

const OUTLINE_DESCRIPTION =
  "Read a saved .fig file from disk and list every screen (top-level frame) " +
  "across every page. The headless / CI counterpart to plumb_outline — works " +
  "with no Figma desktop, no plugin pairing, no FIGMA_TOKEN. Use this when " +
  "you've exported a .fig file and need to inspect or implement screens " +
  "without opening Figma.";

const NODE_DESCRIPTION =
  "Read one node from a saved .fig file by its id (the `sessionID:localID` " +
  "form returned by plumb_fig_outline). Returns the node's type, name, size, " +
  "auto-layout mode, fills, opacity, and (for TEXT nodes) characters and " +
  "font. Pair with plumb_fig_outline to find the id first.";

/** Registers the `plumb_fig_outline` MCP tool — .fig path counterpart to plumb_outline. */
export function registerPlumbFigOutline(server: McpServer): void {
  server.registerTool(
    "plumb_fig_outline",
    {
      title: "Plumb · fig outline",
      description: OUTLINE_DESCRIPTION,
      inputSchema: {
        figPath: z
          .string()
          .describe("Absolute path to a .fig file on disk."),
      },
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
    },
    async ({ figPath }) => {
      try {
        assertFigPath(figPath);
        if (!existsSync(figPath)) {
          throw new PlumbError(
            `No file at ${figPath}.`,
            "Pass the absolute path to a .fig you've exported from Figma. " +
              "In the Figma desktop app: File → Save local copy (.fig).",
          );
        }
        const file = loadFig(figPath);
        return ok({
          source: "fig",
          file: { name: file.doc.meta?.fileName ?? figPath },
          meta: { screenCount: file.screens.length },
          pages: file.pages,
          next:
            file.screens.length === 0
              ? "The .fig contains no top-level frames — confirm the file was exported correctly."
              : "Call plumb_fig_node with one of these screen ids to fetch a node's details.",
        });
      } catch (e) {
        return fail(e);
      }
    },
  );
}

/** Registers the `plumb_fig_node` MCP tool — fetch a single node from a .fig. */
export function registerPlumbFigNode(server: McpServer): void {
  server.registerTool(
    "plumb_fig_node",
    {
      title: "Plumb · fig node",
      description: NODE_DESCRIPTION,
      inputSchema: {
        figPath: z.string().describe("Absolute path to a .fig file on disk."),
        id: z.string().describe("Node id — `sessionID:localID` form."),
      },
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
    },
    async ({ figPath, id }) => {
      try {
        assertFigPath(figPath);
        if (!existsSync(figPath)) {
          throw new PlumbError(
            `No file at ${figPath}.`,
            "Pass the absolute path to a .fig file — same as plumb_fig_outline.",
          );
        }
        const file = loadFig(figPath);
        const node = figNodeById(file, id);
        if (!node) {
          throw new PlumbError(
            `Node ${id} not found in ${figPath}.`,
            "Call plumb_fig_outline to list valid screen ids, then drill into one.",
          );
        }
        return ok({
          source: "fig",
          node: {
            id,
            name: node.name,
            type: node.type,
            size: node.size
              ? { w: Math.round(node.size.x), h: Math.round(node.size.y) }
              : null,
            stackMode: node.stackMode,
            cornerRadius: node.cornerRadius,
            opacity: node.opacity,
            fillCount: Array.isArray(node.fillPaints) ? node.fillPaints.length : 0,
            strokeCount: Array.isArray(node.strokePaints) ? node.strokePaints.length : 0,
            text: node.textData
              ? {
                  characters: node.textData.characters,
                  fontSize: node.fontSize,
                  fontFamily: node.fontName?.family,
                  fontStyle: node.fontName?.style,
                }
              : null,
          },
          next:
            "This MVP exposes basic metadata. Future iterations will return a " +
            "full PDS with auto-layout → flexbox, deduped tokens, and stable el handles.",
        });
      } catch (e) {
        return fail(e);
      }
    },
  );
}
