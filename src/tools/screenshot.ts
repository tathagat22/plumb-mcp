import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { resolveScreen, screenName } from "../bridge/inventory";
import { requestScreenshot } from "../bridge/server";
import { bridge } from "../bridge/store";
import { PlumbError } from "../errors";
import { fail, ok } from "./shared";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

const DESCRIPTION =
  "Render a Figma screen or node to PNG (or JPG) and save it locally; returns " +
  "the file path. Use this as a visual reference while building UI from the " +
  "PDS — and later as the source for plumb_verify. Plugin path; needs the " +
  "Plumb plugin paired.";

function slug(s: string): string {
  return (
    s
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "screenshot"
  );
}

/** Registers the `plumb_screenshot` MCP tool (plan §8). */
export function registerPlumbScreenshot(server: McpServer): void {
  server.registerTool(
    "plumb_screenshot",
    {
      title: "Plumb · screenshot",
      description: DESCRIPTION,
      inputSchema: {
        id: z.string().optional().describe("Node id to render."),
        name: z.string().optional().describe("Screen name — resolved against the file."),
        scale: z
          .number()
          .positive()
          .max(4)
          .optional()
          .describe("Render scale. Default 2."),
        format: z
          .enum(["PNG", "JPG"])
          .optional()
          .describe("Output format. Default PNG."),
      },
      annotations: { readOnlyHint: false, idempotentHint: true, openWorldHint: false },
    },
    async (args) => {
      try {
        if (!bridge.paired) {
          throw new PlumbError(
            "No Figma plugin is paired.",
            "plumb_screenshot uses the plugin path — run the Plumb plugin in Figma and click 'Pair with Plumb'.",
          );
        }
        const resolved = resolveScreen(args.id, args.name);
        if ("ambiguous" in resolved) {
          return ok({
            ambiguous: true,
            matches: resolved.ambiguous,
            next: "Several screens share that name — re-call plumb_screenshot with one of these `id` values.",
          });
        }
        const { dataBase64, format, nodeName, error } = await requestScreenshot(
          resolved.id,
          args.scale,
          args.format,
        );
        if (error) {
          throw new PlumbError(
            `The plugin could not render the screenshot: ${error}`,
            "Retry; if it persists, the node may have been deleted or renamed.",
          );
        }
        const root =
          process.env.PLUMB_SCREENSHOTS_DIR ?? join(process.cwd(), "plumb-screenshots");
        mkdirSync(root, { recursive: true });
        const ext = format.toLowerCase();
        const file = slug(nodeName || screenName(resolved.id) || resolved.id) + "." + ext;
        const path = join(root, file);
        const buffer = Buffer.from(dataBase64, "base64");
        writeFileSync(path, buffer);
        return ok({
          source: "plugin",
          screen: nodeName,
          path,
          format,
          bytes: buffer.length,
          scale: args.scale ?? 2,
          next: "Use this image as the visual reference of the design — compare it against what you build.",
        });
      } catch (e) {
        return fail(e);
      }
    },
  );
}
