import { z } from "zod";
import { buildSemanticGraph } from "../semantic/build";
import { diffSemanticGraphs } from "../semantic/diff";
import { runEnrichers } from "../semantic/enricher";
import { RoleEnricher } from "../semantic/enrichers/role";
import { asPdsDocument, fail, ok } from "./shared";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

const DESCRIPTION =
  "Semantic diff between two PDS snapshots of the same screen — call " +
  "plumb_node (or plumb_outline/plumb_query) once before a design change and " +
  "once after, then pass both raw JSON responses here. Returns structured " +
  "deltas (added/removed/renamed/changed nodes, each with a `note` — e.g. " +
  "'the hero moved from (0, 0) to (0, 120)') plus a one-line `summary`, not a " +
  "JSON diff. Narration uses the same role labels plumb_node already returns " +
  "on `pattern` (nav/hero/footer/sidebar/card/button) when available, so " +
  "'the hero moved' beats 'el btn-3 moved 40px' whenever a role was detected. " +
  "This tool does no live Figma fetching itself — it only compares two " +
  "documents you already have.";

const PDS_DOC_DESCRIPTION =
  "A full PdsDocument object exactly as returned by plumb_node / " +
  "plumb_outline / plumb_query (the `nodes` + `root` fields are required).";

/** Registers the `plumb_diff` MCP tool. */
export function registerPlumbDiff(server: McpServer): void {
  server.registerTool(
    "plumb_diff",
    {
      title: "Plumb · diff",
      description: DESCRIPTION,
      inputSchema: {
        before: z.record(z.unknown()).describe(`Snapshot taken BEFORE the change. ${PDS_DOC_DESCRIPTION}`),
        after: z.record(z.unknown()).describe(`Snapshot taken AFTER the change. ${PDS_DOC_DESCRIPTION}`),
      },
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
    },
    async (args) => {
      try {
        const before = asPdsDocument(args.before, "before");
        const after = asPdsDocument(args.after, "after");

        const beforeGraph = buildSemanticGraph(before);
        const afterGraph = buildSemanticGraph(after);

        const roleOf = (annotations: ReturnType<typeof runEnrichers>) =>
          new Map(annotations.filter((a) => a.namespace === "role").map((a) => [a.nodeId, String(a.value)]));

        const beforeRoles = roleOf(runEnrichers(beforeGraph, [RoleEnricher]));
        const afterRoles = roleOf(runEnrichers(afterGraph, [RoleEnricher]));

        const diff = diffSemanticGraphs(beforeGraph, afterGraph, { before: beforeRoles, after: afterRoles });
        return ok(diff);
      } catch (e) {
        return fail(e);
      }
    },
  );
}
