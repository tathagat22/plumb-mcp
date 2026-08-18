/**
 * Reusable components: a named, prop-parameterised block tree with named
 * slots. `Instance` blocks reference one by name and fill its slots.
 */

import { z } from "zod";
import { type Block, lazyBlock } from "./blocks";

// ============================================================================
// Components
// ============================================================================

export interface PropDef {
  name: string;
  type: "text" | "number" | "boolean" | "color" | "enum";
  default?: string | number | boolean;
  options?: string[];
}

/** Body strings accept `"@prop.<name>"`; Slot blocks pull from Instance.slots. */
export interface Component {
  name: string;
  props?: PropDef[];
  slots?: string[];
  body: Block;
}

// ---- Components ------------------------------------------------------------

const PropDefSchema: z.ZodType<PropDef> = z.object({
  name: z.string(),
  type: z.enum(["text", "number", "boolean", "color", "enum"]),
  default: z.union([z.string(), z.number(), z.boolean()]).optional(),
  options: z.array(z.string()).optional(),
});

export const ComponentSchema: z.ZodType<Component> = z.object({
  name: z.string(),
  props: z.array(PropDefSchema).optional(),
  slots: z.array(z.string()).optional(),
  body: lazyBlock,
});
