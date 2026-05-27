import { z } from "zod";
import { formatScreenMatches, resolveScreen } from "../bridge/inventory";
import { requestNode } from "../bridge/server";
import { bridge } from "../bridge/store";
import { PlumbError } from "../errors";
import { fetchNodeViaRest } from "../figma/rest";
import { resolveFigmaTarget } from "../figma/url";
import { normalize } from "../normalize/normalize";
import { estimateTokens } from "../util/estimate";
import { fail, ok, requireToken } from "./shared";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { FigmaFileResult } from "../figma/types";
import type { PdsDocument, PdsNode } from "../pds";

const DESCRIPTION =
  "Query a Figma subtree by pattern instead of dumping the whole tree. " +
  "Use this on dense screens where plumb_node would be too big — pull a " +
  "skeleton (structure only, no text/fills/effects), every button, every " +
  "TEXT node above a size, every instance of a component. Mirrors the same " +
  "scope-resolution as plumb_node: pass `id` or `name` with the plugin " +
  "paired, or `fileKey` + `id` (or a Figma URL) on the REST path.";

type Select = "skeleton" | "buttons" | "text" | "components";

interface QueryResult {
  scope: { id: string; name: string | null };
  select: Select;
  matches: PdsNode[];
  meta: { count: number; estTokens: number };
  next: string;
}

/** Registers the `plumb_query` MCP tool (v0.10 Phase 5). */
export function registerPlumbQuery(server: McpServer): void {
  server.registerTool(
    "plumb_query",
    {
      title: "Plumb · query",
      description: DESCRIPTION,
      inputSchema: {
        fileKey: z
          .string()
          .optional()
          .describe("Figma file key — REST path. Omit when the plugin is paired."),
        url: z
          .string()
          .optional()
          .describe("Paste a full Figma URL — fileKey and node-id auto-extracted."),
        id: z.string().optional().describe("Node/screen id to query within."),
        name: z
          .string()
          .optional()
          .describe("Screen name — plugin path, resolved against the paired file."),
        select: z
          .enum(["skeleton", "buttons", "text", "components"])
          .describe(
            'Query pattern. "skeleton" = structure-only (drops chars, fills, ' +
              'effects, vectorPath, text refs). "buttons" = nodes Plumb tagged ' +
              'with pattern: button. "text" = TEXT nodes, optionally filtered by ' +
              'font-size min/max. "components" = INSTANCE nodes, optionally ' +
              "filtered to a specific componentId.",
          ),
        min: z
          .number()
          .optional()
          .describe('Minimum font size for select: "text".'),
        max: z
          .number()
          .optional()
          .describe('Maximum font size for select: "text".'),
        componentId: z
          .string()
          .optional()
          .describe('Filter for select: "components" — return only instances of this component.'),
      },
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
    },
    async (args) => {
      try {
        const { fileKey, id } = resolveFigmaTarget({
          url: args.url,
          fileKey: args.fileKey,
          id: args.id,
        });

        // Fetch the full subtree — query operates on a complete PDS, so depth
        // is maxed. Plugin path uses requestNode (with cache); REST hits REST.
        let pds: PdsDocument;
        let nodeName: string | null = null;
        if (bridge.paired && (id || args.name)) {
          const resolved = resolveScreen(id, args.name);
          if ("ambiguous" in resolved) {
            return ok({
              ambiguous: true,
              matches: formatScreenMatches(resolved.ambiguous),
              next:
                "Several screens share that name. Pick one and re-call plumb_query with its `id`.",
            });
          }
          const { doc, nodeName: n } = await requestNode(resolved.id);
          if (!doc) {
            throw new PlumbError(
              `The Plumb plugin could not find node "${resolved.id}".`,
              "Call plumb_outline for the current screen list.",
            );
          }
          nodeName = n;
          const file: FigmaFileResult = {
            document: doc,
            fileName: bridge.inventory?.fileName ?? "",
            version: `plugin-${Date.now()}`,
          };
          pds = normalize(file, 12, {});
        } else {
          if (!fileKey || !id) {
            throw new PlumbError(
              "plumb_query needs the Plumb plugin paired, or fileKey + id (or a Figma url) for REST.",
              "Pair the plugin in Figma, pass a Figma URL via `url`, or pass fileKey and id.",
            );
          }
          const token = requireToken();
          const file = await fetchNodeViaRest({ fileKey, nodeId: id, depth: 12, token });
          pds = normalize(file, 12, {});
        }

        const matches = applySelect(pds, args.select, {
          min: args.min,
          max: args.max,
          componentId: args.componentId,
        });

        const result: QueryResult = {
          scope: { id: id ?? args.name ?? "", name: nodeName },
          select: args.select,
          matches,
          meta: {
            count: matches.length,
            estTokens: estimateTokens(JSON.stringify(matches)),
          },
          next:
            args.select === "skeleton"
              ? "Use the skeleton to grasp shape; call plumb_node for full data on the branches you need."
              : "Drill into a match with plumb_node({ id: match.id }) for full detail.",
        };
        return ok({ ...result, tokens: pds.tokens, source: bridge.paired ? "plugin" : "rest" });
      } catch (e) {
        return fail(e);
      }
    },
  );
}

/** Apply a select pattern to the normalized PDS. Pure / synchronous. */
function applySelect(
  pds: PdsDocument,
  select: Select,
  args: { min?: number; max?: number; componentId?: string },
): PdsNode[] {
  const all = Object.values(pds.nodes);
  switch (select) {
    case "skeleton":
      // Strip leaf data, keep the structural skeleton. The agent gets the
      // shape of the screen for ~10× fewer tokens; they then drill into the
      // branches that matter with plumb_node.
      return all.map((n) => {
        const skeleton: Partial<PdsNode> & Pick<PdsNode, "id" | "el" | "type" | "box"> = {
          id: n.id,
          el: n.el,
          type: n.type,
          box: n.box,
        };
        // Keep structural / layout fields, drop content fields.
        if (n.name) skeleton.name = n.name;
        if (n.layout) skeleton.layout = n.layout;
        if (n.pos) skeleton.pos = n.pos;
        if (n.children) skeleton.children = n.children;
        if (n.more) skeleton.more = n.more;
        if (n.pattern) skeleton.pattern = n.pattern;
        if (n.component) skeleton.component = n.component;
        return skeleton as PdsNode;
      });

    case "buttons":
      return all.filter((n) => n.pattern === "button");

    case "text": {
      const textNodes = all.filter((n) => n.type === "text");
      if (args.min === undefined && args.max === undefined) return textNodes;
      // Resolve $tN refs → numeric font size. Token string format is
      // "weight sizepx/lh family ..." — pull the digits between space and 'px'.
      const sizeOf = (n: PdsNode): number | undefined => {
        const ref = n.text;
        if (!ref) return undefined;
        const tok = pds.tokens.text[ref];
        if (!tok) return undefined;
        const m = /\s(\d+(?:\.\d+)?)px/.exec(tok);
        return m ? Number(m[1]) : undefined;
      };
      return textNodes.filter((n) => {
        const size = sizeOf(n);
        if (size === undefined) return false;
        if (args.min !== undefined && size < args.min) return false;
        if (args.max !== undefined && size > args.max) return false;
        return true;
      });
    }

    case "components": {
      const instances = all.filter((n) => n.type === "instance");
      if (!args.componentId) return instances;
      return instances.filter((n) => {
        if (typeof n.component === "string") return n.component === args.componentId;
        if (n.component && typeof n.component === "object") return n.component.id === args.componentId;
        return false;
      });
    }
  }
}
