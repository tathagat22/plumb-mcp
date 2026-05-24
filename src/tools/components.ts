import { z } from "zod";
import { requestComponents } from "../bridge/server";
import { bridge } from "../bridge/store";
import { PlumbError } from "../errors";
import { fail, ok } from "./shared";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

const DESCRIPTION =
  "List every Figma component definition in the file and the instance usages " +
  "of each — useful for understanding the design system before building. " +
  "Each component carries an instance count; each instance carries the " +
  "component id, so you can match usage to definition. Plugin path; needs " +
  "the Plumb plugin paired.";

/** Registers the `plumb_components` MCP tool (plan §8). */
export function registerPlumbComponents(server: McpServer): void {
  server.registerTool(
    "plumb_components",
    {
      title: "Plumb · components",
      description: DESCRIPTION,
      inputSchema: {
        page: z
          .string()
          .optional()
          .describe(
            "Filter components and instances to a single Figma page by name " +
              "(case-insensitive, substring-friendly). Massive token saver on " +
              "files that hide a 200-variant style guide on one page.",
          ),
      },
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
    },
    async (args) => {
      try {
        if (!bridge.paired) {
          throw new PlumbError(
            "No Figma plugin is paired.",
            "plumb_components uses the plugin path — run the Plumb plugin in Figma and click 'Pair with Plumb'.",
          );
        }
        const { components, instances, error } = await requestComponents();
        if (error) {
          throw new PlumbError(
            `The plugin could not gather components: ${error}`,
            "Retry; if it persists, re-run the Plumb plugin in Figma.",
          );
        }
        const pageFilter = args.page?.trim().toLowerCase();
        const filterFn = pageFilter
          ? <T extends { page?: string }>(x: T): boolean =>
              (x.page ?? "").toLowerCase().includes(pageFilter)
          : (): boolean => true;
        const filteredComponents = components.filter(filterFn);
        const filteredInstances = instances.filter(filterFn);
        return ok({
          source: "plugin",
          ...(pageFilter ? { page: args.page } : {}),
          componentCount: filteredComponents.length,
          instanceCount: filteredInstances.length,
          components: filteredComponents,
          instances: filteredInstances,
          next:
            filteredComponents.length === 0
              ? "No components defined" + (pageFilter ? ` on the "${args.page}" page.` : " in this file.")
              : "Each instance has a componentId — match it to a definition. Use plumb_node by id to inspect either.",
        });
      } catch (e) {
        return fail(e);
      }
    },
  );
}
