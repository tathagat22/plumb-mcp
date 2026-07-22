import {
  mkdirSync,
  renameSync,
  copyFileSync,
  statSync,
  unlinkSync,
  existsSync,
} from "node:fs";
import { isAbsolute, join, parse, resolve, sep } from "node:path";
import { z } from "zod";
import { formatScreenMatches, resolveScreen, screenName } from "../bridge/inventory";
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

/**
 * Pick a non-colliding path under `root`. If `path` is free, return it;
 * otherwise insert `-2`, `-3`, … before the extension until one is.
 */
function uniquePath(path: string): string {
  if (!existsSync(path)) return path;
  const { dir, name, ext } = parse(path);
  for (let i = 2; i < 1000; i++) {
    const next = join(dir, `${name}-${i}${ext}`);
    if (!existsSync(next)) return next;
  }
  return path;
}

/**
 * Resolve the final on-disk path. `out` accepts either an absolute path or
 * a filename (relative to `root`); extension is normalised to match the
 * actual rendered format. Without `out`, default to
 * `<slug(name)>-<slug(id)>.<ext>` and auto-suffix on collision so back-to-back
 * exports of two screens that share a name don't overwrite each other.
 */
/** `out` may steer within cwd or the screenshots root, never outside both —
 *  an agent induced to pass an arbitrary absolute path (e.g. into a startup
 *  directory) must not get an unconfined filesystem write. */
function assertConfined(path: string, root: string): void {
  const resolved = resolve(path);
  const allowedRoots = [resolve(root), resolve(process.cwd())];
  const within = allowedRoots.some(
    (allowed) => resolved === allowed || resolved.startsWith(allowed + sep),
  );
  if (!within) {
    throw new PlumbError(
      `\`out\` resolves outside the allowed directories: "${resolved}".`,
      `Use a relative filename, or an absolute path under the current directory or the screenshots root ("${resolve(root)}").`,
    );
  }
}

function pickPath(
  root: string,
  ext: string,
  nodeName: string,
  nodeId: string,
  out: string | undefined,
): string {
  if (out) {
    const explicit = isAbsolute(out) ? out : join(root, out);
    assertConfined(explicit, root);
    const parsed = parse(explicit);
    const fixed = parsed.ext.toLowerCase() === `.${ext}` ? explicit : `${explicit}.${ext}`;
    return uniquePath(fixed);
  }
  const idSlug = slug(nodeId);
  const nameSlug = slug(nodeName);
  const file = `${nameSlug}-${idSlug}.${ext}`;
  return uniquePath(join(root, file));
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
        out: z
          .string()
          .optional()
          .describe(
            "Output path or filename. Absolute paths are honoured as-is; " +
              "bare filenames are placed under the screenshots directory. " +
              "Defaults to '<name>-<id>.<ext>', auto-suffixed on collision.",
          ),
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
            matches: formatScreenMatches(resolved.ambiguous),
            next:
              "Several screens share that name. Each row shows `page` and " +
              "`box` (w×h) — pick the one you want and re-call plumb_screenshot with its `id`.",
          });
        }
        const { path: tempPath, format, nodeName, error } = await requestScreenshot(
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
        if (!tempPath) {
          throw new PlumbError(
            "The plugin reported a screenshot but no image bytes arrived.",
            "Re-run the Plumb plugin and retry; if it persists, file a bug.",
          );
        }
        const root =
          process.env.PLUMB_SCREENSHOTS_DIR ?? join(process.cwd(), "plumb-screenshots");
        const ext = format.toLowerCase();
        const path = pickPath(
          root,
          ext,
          nodeName || screenName(resolved.id) || resolved.id,
          resolved.id,
          args.out,
        );
        mkdirSync(parse(path).dir, { recursive: true });
        // Prefer rename (same filesystem — atomic), fall back to copy+unlink if
        // the OS temp dir is on a different volume.
        try {
          renameSync(tempPath, path);
        } catch {
          copyFileSync(tempPath, path);
          try { unlinkSync(tempPath); } catch { /* leave the temp file */ }
        }
        const bytes = statSync(path).size;
        return ok({
          source: "plugin",
          screen: nodeName,
          path,
          format,
          bytes,
          scale: args.scale ?? 2,
          next: "Use this image as the visual reference of the design — compare it against what you build.",
        });
      } catch (e) {
        return fail(e);
      }
    },
  );
}
