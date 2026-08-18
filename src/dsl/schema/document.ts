/**
 * The top of the DSL: pages and the document that holds them. `DesignDocSchema`
 * is the single validator the prompt→DSL layer runs model output through
 * before anything reaches `compile()`.
 */

import { z } from "zod";
import { type Brand, BrandSchema } from "./brand";
import { type Component, ComponentSchema } from "./components";
import { type DslPrototype, DslPrototypeSchema } from "./motion";
import { type Color, ColorSchema } from "./scalars";
import { type Section, SectionSchema } from "./sections";

// ============================================================================
// Pages & document
// ============================================================================

export interface Page {
  id?: string;
  name: string;
  width?: number;
  height?: number | "auto";
  bg?: Color;
  sections: Section[];
}

export interface DesignDoc {
  version: "1";
  meta?: { name?: string; description?: string };
  brand: Brand;
  components?: Component[];
  pages: Page[];
  prototype?: DslPrototype;
}

// ---- Page & document ------------------------------------------------------

export const PageSchema: z.ZodType<Page> = z.object({
  id: z.string().optional(),
  name: z.string(),
  width: z.number().optional(),
  height: z.union([z.number(), z.literal("auto")]).optional(),
  bg: ColorSchema.optional(),
  sections: z.array(SectionSchema),
});

/** The one schema the prompt->DSL layer validates model output against. */
export const DesignDocSchema: z.ZodType<DesignDoc> = z.object({
  version: z.literal("1"),
  meta: z
    .object({ name: z.string().optional(), description: z.string().optional() })
    .optional(),
  brand: BrandSchema,
  components: z.array(ComponentSchema).optional(),
  pages: z.array(PageSchema),
  prototype: DslPrototypeSchema.optional(),
});
