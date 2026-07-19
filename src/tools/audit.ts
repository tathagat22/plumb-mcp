import { z } from "zod";
import { buildSemanticGraph } from "../semantic/build";
import { runEnrichers } from "../semantic/enricher";
import { AccessibilityEnricher } from "../semantic/enrichers/accessibility";
import { RoleEnricher } from "../semantic/enrichers/role";
import { projectAuditReport } from "../semantic/project/audit";
import { asPdsDocument, fail, ok } from "./shared";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

const DESCRIPTION =
  "Heuristic accessibility audit over a PDS snapshot — pass the raw JSON " +
  "response from a prior plumb_node/plumb_outline/plumb_query call. Checks " +
  "today: text contrast against its resolved ancestor background (WCAG AA, " +
  "large-text threshold applied at ≥24px) and role:\"button\" nodes under the " +
  "44×44px minimum touch-target size. Each finding carries a plain-language " +
  "`note` plus the raw ratio/box data. This is a heuristic problem-finder, " +
  "not a certified WCAG audit — it reports failures only (a clean result " +
  "means the checks it runs found nothing, not that the screen is fully " +
  "accessible), and heading-order / missing-alt-text checks aren't built yet.";

/** Registers the `plumb_audit` MCP tool. */
export function registerPlumbAudit(server: McpServer): void {
  server.registerTool(
    "plumb_audit",
    {
      title: "Plumb · audit",
      description: DESCRIPTION,
      inputSchema: {
        doc: z
          .record(z.unknown())
          .describe(
            "A full PdsDocument object exactly as returned by plumb_node / plumb_outline / plumb_query.",
          ),
      },
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
    },
    async (args) => {
      try {
        const doc = asPdsDocument(args.doc, "doc");
        const graph = buildSemanticGraph(doc);
        const annotations = runEnrichers(graph, [RoleEnricher, AccessibilityEnricher]);
        return ok(projectAuditReport(annotations));
      } catch (e) {
        return fail(e);
      }
    },
  );
}
