import { z } from "zod";
import { buildSemanticGraph } from "../semantic/build";
import { runEnrichers } from "../semantic/enricher";
import { RoleEnricher } from "../semantic/enrichers/role";
import { graphFromWebSpec } from "../semantic/project/web";
import { lowerToReact } from "../emit/react";
import { PlumbError } from "../errors";
import { fail, ok } from "./shared";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { SemanticGraph } from "../semantic/graph";
import type { PdsDocument } from "../pds";
import type { WebSpecDocument } from "../semantic/project/web";

const DESCRIPTION =
  "Deterministic PDS/WebSpec → React (JSX + inline styles) code generator. " +
  "Pass the raw JSON from a prior plumb_node/plumb_outline/plumb_query call " +
  "(Figma) OR a prior plumb_import_web call (a live site) — the same emitter " +
  "handles both, proving the underlying graph is source-agnostic. Not an LLM " +
  "call: template-based and deterministic, mirroring the existing PDS→Figma " +
  "emit path's own 'every conversion happens here, mechanically' design. " +
  "Output is PIXEL-FAITHFUL (every box's width/height is emitted explicitly), " +
  "not a hand-tuned responsive component — there's no hug/fill/fixed sizing " +
  "signal in the graph yet to generate `flex:1`/`width:auto` from. Check the " +
  "`warnings` array: vector nodes render as empty boxes (no path data is " +
  "reproduced) and images with no captured source get an empty `src`.";

function detectAndBuildGraph(raw: Record<string, unknown>): { graph: SemanticGraph; roleByNode: Map<string, string> } {
  if ("tokens" in raw && "nodes" in raw && "root" in raw) {
    const doc = raw as unknown as PdsDocument;
    const graph = buildSemanticGraph(doc);
    const roleByNode = new Map(
      runEnrichers(graph, [RoleEnricher])
        .filter((a) => a.namespace === "role")
        .map((a) => [a.nodeId, String(a.value)]),
    );
    return { graph, roleByNode };
  }
  if ("url" in raw && "nodes" in raw && "root" in raw) {
    return graphFromWebSpec(raw as unknown as WebSpecDocument);
  }
  throw new PlumbError(
    "`doc` doesn't look like a PdsDocument (has `tokens`+`nodes`+`root`) or a WebSpecDocument (has `url`+`nodes`+`root`).",
    "Pass the raw JSON object returned by plumb_node/plumb_outline/plumb_query, or by plumb_import_web, unmodified.",
  );
}

/** Registers the `plumb_emit_react` MCP tool. */
export function registerPlumbEmitReact(server: McpServer): void {
  server.registerTool(
    "plumb_emit_react",
    {
      title: "Plumb · emit react",
      description: DESCRIPTION,
      inputSchema: {
        doc: z
          .record(z.unknown())
          .describe("A PdsDocument (Figma) or a WebSpecDocument (plumb_import_web) — auto-detected."),
        componentName: z.string().optional().describe('Default "GeneratedComponent".'),
      },
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
    },
    async (args) => {
      try {
        const { graph, roleByNode } = detectAndBuildGraph(args.doc);
        const result = lowerToReact(graph, { componentName: args.componentName, roleByNode });
        return ok(result);
      } catch (e) {
        return fail(e);
      }
    },
  );
}
