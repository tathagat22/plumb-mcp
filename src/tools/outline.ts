import { z } from "zod";
import { cacheGet, cacheSet, DEFAULT_TTL_MS } from "../cache";
import { pluginOutline } from "../bridge/inventory";
import { bridge } from "../bridge/store";
import { PlumbError } from "../errors";
import { fetchFileOutline } from "../figma/rest";
import { resolveFigmaTarget } from "../figma/url";
import { buildOutline } from "../normalize/outline";
import { fail, ok, requireToken } from "./shared";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { OutlineDocument } from "../normalize/outline";

/**
 * Drop every page whose name doesn't match. We keep the response shape stable
 * (still `{ pages: [...] }`) so callers don't need a separate code path for
 * the filtered case. Recomputes derived counts to reflect the filter.
 */
function filterByPage<T extends { pages?: unknown[]; meta?: Record<string, unknown> }>(
  outline: T,
  pageFilter: string | undefined,
): T {
  if (!pageFilter) return outline;
  const pages = (outline.pages ?? []) as Array<{ name?: string; frames?: unknown[]; screens?: unknown[] }>;
  const kept = pages.filter((p) => (p?.name ?? "").toLowerCase() === pageFilter);
  if (kept.length === 0) {
    // Fall back to substring match so "test" finds a "testing" page.
    const fuzzy = pages.filter((p) => (p?.name ?? "").toLowerCase().includes(pageFilter));
    if (fuzzy.length) return rebuildOutline(outline, fuzzy);
  }
  return rebuildOutline(outline, kept);
}

function rebuildOutline<T extends { pages?: unknown[]; meta?: Record<string, unknown> }>(
  outline: T,
  pages: Array<{ frames?: unknown[]; screens?: unknown[] }>,
): T {
  const screenCount = pages.reduce(
    (n, p) => n + ((p.frames ?? p.screens ?? []) as unknown[]).length,
    0,
  );
  const meta = { ...(outline.meta ?? {}) };
  // plugin path uses screenCount, REST uses frameCount — keep both honest.
  if ("frameCount" in meta) meta.frameCount = screenCount;
  if ("screenCount" in meta) meta.screenCount = screenCount;
  meta.pageCount = pages.length;
  return { ...outline, pages, meta } as T;
}

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
        url: z
          .string()
          .optional()
          .describe(
            "Paste a full Figma URL — fileKey is auto-extracted. Accepts /design/, /file/, /proto/, and branch URLs.",
          ),
        page: z
          .string()
          .optional()
          .describe(
            "Filter to a single Figma page by name (case-insensitive). " +
              "Saves tokens on multi-page files where most pages are irrelevant.",
          ),
      },
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
    },
    async (args) => {
      try {
        const { fileKey } = resolveFigmaTarget({ url: args.url, fileKey: args.fileKey });
        const pageFilter = args.page?.trim().toLowerCase();

        // Plugin path — the live inventory, no file key.
        if (bridge.paired && bridge.inventory && !fileKey) {
          return ok(
            filterByPage(
              pluginOutline() as { pages?: unknown[]; meta?: Record<string, unknown> },
              pageFilter,
            ),
          );
        }

        // REST path.
        if (!fileKey) {
          throw new PlumbError(
            "plumb_outline needs the Plumb plugin paired, or a fileKey / url for the REST path.",
            "Pair the Plumb plugin in Figma, paste a Figma URL via `url`, or pass a fileKey.",
          );
        }
        const cacheKey = `outline:${fileKey}`;
        const hit = cacheGet<OutlineDocument>(cacheKey, DEFAULT_TTL_MS);
        if (hit) return ok({ ...filterByPage(hit.payload, pageFilter), cached: true });

        const token = requireToken();
        const file = await fetchFileOutline(fileKey, token);
        const outline = buildOutline(file.document, {
          key: fileKey,
          name: file.fileName,
          version: file.version,
        });
        cacheSet(cacheKey, file.version, outline);
        return ok({ ...filterByPage(outline, pageFilter), cached: false });
      } catch (e) {
        return fail(e);
      }
    },
  );
}
