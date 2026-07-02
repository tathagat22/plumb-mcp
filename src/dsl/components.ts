/**
 * Component template expansion.
 *
 * A DSL Component is a named Block tree with prop placeholders (`"@prop.name"`
 * inside string fields) and named Slots (`{ type: "slot", name }`) that pull
 * children from the Instance. Expansion deep-clones the template, substitutes
 * prop values, and splices slot content — producing a plain Block the lowerer
 * treats like any other. The instance's root node is later tagged with a
 * `dsl:<name>` component id (blocks.ts) so the round-trip PDS records the
 * component relationship, and the sidecar surfaces `name → {id, el, props}`.
 */

import type { Block, Component, Instance, PropDef, Stack } from "./schema";

export interface ComponentSidecar {
  [name: string]: { id: string; el: string; props: PropDef[] };
}

/** Build a name→Component map, applying prop defaults later at expansion time. */
export function indexComponents(components: Component[] | undefined): Map<string, Component> {
  const map = new Map<string, Component>();
  for (const c of components ?? []) map.set(c.name, c);
  return map;
}

/**
 * True when a Block tree contains a `Slot` anywhere — a component with slot
 * content-projection can't be represented as a real Figma INSTANCE (an
 * instance's children are locked to its main component's structure), so the
 * caller falls back to deep-clone expansion for it.
 */
export function hasSlotBlock(block: Block): boolean {
  if (block.type === "slot") return true;
  if (block.type === "stack") return block.children.some(hasSlotBlock);
  return false;
}

/**
 * Build the ONE-TIME master body for a slot-free component: its declared prop
 * defaults substituted in, no instance-specific overrides, no slot content
 * (there is none). The lowerer tags the resulting root `type:"component"` and
 * every Instance thereafter references it by `el` instead of re-expanding it.
 */
export function buildComponentMaster(comp: Component): Block {
  const props: Record<string, string | number | boolean> = {};
  for (const def of comp.props ?? []) {
    if (def.default !== undefined) props[def.name] = def.default;
  }
  return cloneBlock(comp.body, props, {});
}

/**
 * Expand an Instance against its component definition. Returns the substituted
 * Block plus the component name, or `null` when the component is unknown (the
 * caller emits a placeholder + warning).
 */
export function expandInstance(
  inst: Instance,
  components: Map<string, Component>,
): { block: Block; componentName: string } | null {
  const comp = components.get(inst.component);
  if (!comp) return null;

  // Resolve the effective prop values: instance overrides over declared defaults.
  const props: Record<string, string | number | boolean> = {};
  for (const def of comp.props ?? []) {
    if (def.default !== undefined) props[def.name] = def.default;
  }
  for (const [k, v] of Object.entries(inst.props ?? {})) props[k] = v;

  const block = cloneBlock(comp.body, props, inst.slots ?? {});
  return { block, componentName: comp.name };
}

/** Deep-clone a block, substituting props in strings and resolving slots. */
function cloneBlock(
  block: Block,
  props: Record<string, string | number | boolean>,
  slots: Record<string, Block[]>,
): Block {
  const rec = { ...(block as unknown as Record<string, unknown>) };

  // Substitute prop placeholders in known string-bearing fields.
  for (const field of STRING_FIELDS) {
    const v = rec[field];
    if (typeof v === "string") rec[field] = subst(v, props);
  }

  // Recurse into children, expanding any Slot blocks inline.
  if (rec.type === "stack") {
    rec.children = expandChildren((block as Stack).children, props, slots);
  }
  return rec as unknown as Block;
}

/** Expand a children array, replacing Slot blocks with their instance content. */
function expandChildren(
  children: Block[] | undefined,
  props: Record<string, string | number | boolean>,
  slots: Record<string, Block[]>,
): Block[] {
  const out: Block[] = [];
  for (const child of children ?? []) {
    if (child.type === "slot") {
      const filled = slots[child.name] ?? [];
      for (const b of filled) out.push(cloneBlock(b, props, slots));
    } else {
      out.push(cloneBlock(child, props, slots));
    }
  }
  return out;
}

/** Fields that may carry a `"@prop.name"` placeholder. */
const STRING_FIELDS = ["text", "label", "placeholder", "name", "href", "alt"] as const;

/** Replace whole-string `"@prop.name"` refs with the prop value. */
function subst(value: string, props: Record<string, string | number | boolean>): string {
  const m = /^@prop\.([A-Za-z0-9_-]+)$/.exec(value);
  if (m) {
    const key = m[1] as string;
    const v = props[key];
    return v === undefined ? value : String(v);
  }
  // Inline interpolation (e.g. "Hello @prop.name").
  return value.replace(/@prop\.([A-Za-z0-9_-]+)/g, (whole, key: string) => {
    const v = props[key];
    return v === undefined ? whole : String(v);
  });
}
