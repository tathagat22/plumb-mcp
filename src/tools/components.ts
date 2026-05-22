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
      inputSchema: {},
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
    },
    async () => {
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
        return ok({
          source: "plugin",
          componentCount: components.length,
          instanceCount: instances.length,
          components,
          instances,
          next:
            components.length === 0
              ? "No components defined in this file."
              : "Each instance has a componentId — match it to a definition. Use plumb_node by id to inspect either.",
        });
      } catch (e) {
        return fail(e);
      }
    },
  );
}
