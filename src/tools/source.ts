import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { emitStudio } from "../studio/events";
import { fail, ok } from "./shared";
import { resolveAsset, searchAssets } from "../assets/search";
import type { SourcedAsset } from "../assets/search";
import type { AssetSpec } from "../dsl/schema";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

const DESCRIPTION =
  "Source design assets from the open web — icons, photos, avatars, " +
  "illustrations — for the write direction. Queries every provider in parallel " +
  "(keyless-first: Iconify, Lorem Picsum, DiceBear always work; Unsplash / " +
  "Pexels / Pixabay activate when their API key is in env) and ranks the " +
  "results with one scoring function, including pick-the-right-icon-pack so a " +
  "design uses ONE consistent icon family. Two modes:\n" +
  "  • search (default) — return ranked candidates (metadata only, no bytes). " +
  "Cheap; use to see what's available and which icon pack was locked.\n" +
  "  • fetch — resolve the best match, download its bytes to a local folder, " +
  "and return the path (+ inline SVG / small data: URI). Never fails: a total " +
  "miss degrades to a deterministic placeholder.";

const KINDS = [
  "icon",
  "photo",
  "illustration",
  "avatar",
  "pattern",
  "font",
  "mockup",
  "logo",
  "generated",
] as const;

const STYLES = [
  "flat",
  "line",
  "outline",
  "filled",
  "duotone",
  "3d",
  "photo",
  "illustration",
  "hand-drawn",
  "geometric",
  "gradient",
] as const;

const WEIGHTS = ["thin", "light", "regular", "medium", "bold"] as const;

function slug(s: string): string {
  return (
    s
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48) || "asset"
  );
}

/** Write sourced bytes under PLUMB_ASSETS_DIR/sourced/, content-addressed. */
function writeSourced(name: string, r: SourcedAsset): string {
  const root = process.env.PLUMB_ASSETS_DIR ?? join(process.cwd(), "plumb-assets");
  const dir = join(root, "sourced");
  mkdirSync(dir, { recursive: true });
  const hash = createHash("sha1").update(r.bytes!).digest("hex").slice(0, 10);
  const file = `${slug(name)}-${hash}.${r.ext ?? "bin"}`;
  const full = join(dir, file);
  writeFileSync(full, Buffer.from(r.bytes!));
  return full;
}

const INLINE_MAX_BYTES = 64 * 1024;

/** Build an inline `source` string: SVG markup, or a small bitmap data URI. */
function inlineSource(r: SourcedAsset): string | undefined {
  if (!r.bytes) return undefined;
  if (r.ext === "svg") return new TextDecoder().decode(r.bytes);
  if (r.bytes.byteLength > INLINE_MAX_BYTES) return undefined;
  return `data:${r.mime ?? "application/octet-stream"};base64,${Buffer.from(r.bytes).toString("base64")}`;
}

/** Registers the `plumb_source` MCP tool (blueprint §8). */
export function registerPlumbSource(server: McpServer): void {
  server.registerTool(
    "plumb_source",
    {
      title: "Plumb · source",
      description: DESCRIPTION,
      inputSchema: {
        query: z.string().describe("What to look for, e.g. 'rocket launch' or 'shopping cart'."),
        mode: z
          .enum(["search", "fetch"])
          .optional()
          .describe("`search` (default) returns ranked candidates; `fetch` downloads the best."),
        kind: z.enum(KINDS).optional().describe("Constrain to one asset kind."),
        style: z.array(z.enum(STYLES)).optional().describe("Preferred style tags (ranking hint)."),
        weight: z.enum(WEIGHTS).optional().describe("Icon weight preference."),
        aspect: z.number().optional().describe("Target width/height ratio (ranking hint)."),
        minWidth: z.number().optional().describe("Minimum acceptable pixel width."),
        palette: z
          .array(z.string())
          .optional()
          .describe("Brand hex colors — recolors monotone SVG icons."),
        seed: z.string().optional().describe("Deterministic seed for avatars / placeholders."),
        provider: z
          .string()
          .optional()
          .describe("Restrict to one provider id (iconify, unsplash, pexels, pixabay, dicebear, picsum, …)."),
        w: z.number().optional().describe("Desired width (photos / placeholders)."),
        h: z.number().optional().describe("Desired height (photos / placeholders)."),
        limit: z.number().int().positive().optional().describe("Max candidates in search mode. Default 16."),
        inline: z
          .boolean()
          .optional()
          .describe("fetch mode: also return the bytes inline (SVG markup / small data: URI)."),
      },
      annotations: { readOnlyHint: false, idempotentHint: false, openWorldHint: true },
    },
    async (args) => {
      try {
        const spec: AssetSpec = {
          query: args.query,
          kind: args.kind,
          style: args.style,
          weight: args.weight,
          aspect: args.aspect,
          minWidth: args.minWidth,
          palette: args.palette,
          seed: args.seed,
          provider: args.provider,
          w: args.w,
          h: args.h,
        };
        const mode = args.mode ?? "search";

        if (mode === "search") {
          const res = await searchAssets(spec, { limit: args.limit });
          emitStudio({
            kind: "tool",
            tool: "plumb_source",
            summary: `sourced ${res.candidates.length} candidate(s) for "${args.query}"`,
          });
          return ok({
            mode: "search",
            query: args.query,
            iconPack: res.iconPack,
            providersRun: res.providersRun,
            providersDropped: res.providersDropped,
            count: res.candidates.length,
            candidates: res.candidates.map((c) => ({
              id: c.id,
              provider: c.provider,
              kind: c.kind,
              title: c.title,
              style: c.style,
              w: c.w,
              h: c.h,
              url: c.url,
              license: c.license,
              attribution: c.attribution,
              score: c.score,
            })),
            next:
              res.candidates.length === 0
                ? "No candidates. Broaden the query, drop `provider`, or (for photos) set an UNSPLASH_ACCESS_KEY / PEXELS_API_KEY / PIXABAY_API_KEY in env — Picsum still serves a keyless fallback."
                : "Call plumb_source again with `mode: 'fetch'` (same args) to download the top match, or narrow with `provider`/`style`.",
          });
        }

        // fetch mode
        const r = await resolveAsset(spec, { limit: args.limit });
        if (!r.bytes) {
          return ok({
            mode: "fetch",
            query: args.query,
            resolved: false,
            placeholder: true,
            kind: r.kind,
            next:
              "Could not fetch any bytes (network or every provider missed). Retry, or pass a different `query`/`kind`.",
          });
        }
        const path = writeSourced(args.query, r);
        const source = args.inline ? inlineSource(r) : undefined;
        emitStudio({
          kind: "tool",
          tool: "plumb_source",
          summary: `fetched ${r.kind} for "${args.query}"${r.placeholder ? " (placeholder)" : ""}`,
        });
        return ok({
          mode: "fetch",
          query: args.query,
          resolved: true,
          placeholder: r.placeholder ?? false,
          provider: r.provider,
          kind: r.kind,
          ext: r.ext,
          mime: r.mime,
          path,
          bytes: r.bytes.byteLength,
          w: r.w,
          h: r.h,
          url: r.url,
          scaleMode: r.scaleMode,
          license: r.license,
          attribution: r.attribution,
          ...(r.inlineSvg ? { inlineSvg: r.inlineSvg } : {}),
          ...(source !== undefined ? { source } : {}),
          next:
            "Use `path` when building, or pass these bytes to the plugin inbound channel (stageInboundAsset → GET /asset/:key) during apply. Honor `attribution` where the license requires it.",
        });
      } catch (e) {
        return fail(e);
      }
    },
  );
}
