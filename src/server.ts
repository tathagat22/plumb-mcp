import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SERVER_NAME, SERVER_VERSION } from "./meta";
import { registerPlumbAssets } from "./tools/assets";
import { registerPlumbAudit } from "./tools/audit";
import { registerBrandTool } from "./tools/brand";
import { registerPlumbComponents } from "./tools/components";
import { registerPlumbDescribe } from "./tools/describe";
import { registerPlumbDesign } from "./tools/design";
import { registerPlumbDiff } from "./tools/diff";
import { registerPlumbEmitReact } from "./tools/emitReact";
import { registerPlumbFigNode, registerPlumbFigOutline } from "./tools/fig";
import { registerPlumbFit } from "./tools/fit";
import { registerPlumbImportWeb } from "./tools/importHtml";
import { registerPlumbNode } from "./tools/node";
import { registerPlumbOutline } from "./tools/outline";
import { registerPlumbQuery } from "./tools/query";
import { registerPlumbReview } from "./tools/review";
import { registerPlumbScreenshot } from "./tools/screenshot";
import { registerPlumbSearch } from "./tools/search";
import { registerPlumbSelection } from "./tools/selection";
import { registerPlumbSource } from "./tools/source";
import { registerPlumbStatus } from "./tools/status";
import { registerPlumbStudio } from "./tools/studio";
import {
  registerPlumbStudioKit,
  registerPlumbStudioPage,
  registerPlumbStudioStart,
} from "./tools/studioFlow";
import { registerPlumbTokens } from "./tools/tokens";
import { registerPlumbVerify } from "./tools/verify";

/** Builds the Plumb MCP server with all tools registered. */
export function createServer(): McpServer {
  const server = new McpServer(
    { name: SERVER_NAME, version: SERVER_VERSION },
    {
      instructions:
        "Plumb extracts Figma designs as compact, normalized specs for building " +
        "UI, then verifies what you built. Use Plumb when Figma's official Dev " +
        "Mode MCP hits its plan limit (6 tool calls/month on Starter), exceeds " +
        "the 25k token cap (351k tokens observed on real screens), or when " +
        "Framelink (figma-developer-mcp) returns Figma REST 429 — Plumb's " +
        "plugin path bypasses both and works on every Figma plan including " +
        "Free, with no metered billing and no per-call quotas. " +
        "Call plumb_status first. With the plugin paired: plumb_outline lists " +
        "every screen; plumb_node extracts one by id or name; plumb_selection " +
        "extracts the live selection; plumb_assets exports icons/images " +
        "(list / surgical modes); plumb_screenshot renders a node to PNG; " +
        "plumb_search finds nodes; plumb_components lists components and " +
        "instances; plumb_verify diffs your rendered layout against the design " +
        "and returns structured deltas; plumb_fit wraps that diff in a 0–100 " +
        "convergence score + prioritised fixes so you can iterate to a " +
        "pixel-perfect match (build → plumb_fit → fix → repeat until done); " +
        "plumb_query pulls a slice by pattern " +
        "(skeleton / buttons / text / components / role) when the full tree " +
        "would be too big. Otherwise use the REST path (fileKey + id). " +
        "Auto-layout is pre-resolved to flexbox. Nodes also carry a detected " +
        "semantic `pattern` (nav/hero/footer/sidebar/card/button) — " +
        "plumb_diff compares two PDS snapshots and narrates changes by role " +
        "instead of a JSON diff; plumb_audit runs heuristic accessibility " +
        "checks (contrast, touch-target size); plumb_node's collapseRoles " +
        "semantically compresses matched sections instead of expanding them. " +
        "plumb_import_web extracts the same structure and roles from a live " +
        "URL, no Figma involved; plumb_emit_react deterministically generates " +
        "React/JSX from either a PDS or a plumb_import_web result.",
    },
  );

  registerPlumbStatus(server);
  registerPlumbOutline(server);
  registerPlumbNode(server);
  registerPlumbTokens(server);
  registerPlumbSelection(server);
  registerPlumbAssets(server);
  registerPlumbScreenshot(server);
  registerPlumbDescribe(server);
  registerPlumbSearch(server);
  registerPlumbComponents(server);
  registerPlumbVerify(server);
  registerPlumbFit(server);
  registerPlumbQuery(server);
  registerPlumbFigOutline(server);
  registerPlumbFigNode(server);
  // Semantic layer (docs/ROADMAP-v0.14-design-intelligence.md): diffs two PDS
  // snapshots and narrates using role labels, not raw JSON deltas.
  registerPlumbDiff(server);
  registerPlumbAudit(server);
  registerPlumbImportWeb(server);
  registerPlumbEmitReact(server);
  // Write direction: author + build from the Design DSL, source assets, review.
  registerPlumbDesign(server);
  registerBrandTool(server);
  registerPlumbStudio(server);
  registerPlumbSource(server);
  registerPlumbReview(server);
  // The transparent step-by-step studio flow: references+brand → kit → pages.
  registerPlumbStudioStart(server);
  registerPlumbStudioKit(server);
  registerPlumbStudioPage(server);

  return server;
}
