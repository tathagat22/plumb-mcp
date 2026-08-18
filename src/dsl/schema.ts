/**
 * Plumb Design DSL — the authoritative authoring surface.
 *
 * This barrel is the SINGLE SOURCE OF TRUTH every write-path build agent
 * imports: the semantic language a prompt compiles INTO, which the compiler
 * (src/dsl/compile.ts) then lowers DOWN to the existing PDS IR (src/pds.ts).
 *
 * Two layers:
 *   Layer 1 — semantic Sections (nav / hero / card-grid / features / form /
 *             cta / footer / content / custom) + doc-level Brand tokens +
 *             reusable Components. This is what the prompt targets.
 *   Layer 2 — primitive Blocks (stack / text / image / icon / button / field /
 *             instance / slot / spacer / divider) that map ~1:1 to PdsNode.
 *
 * Sections are SUGAR that expand into Blocks; only Blocks lower to PdsNode.
 * Brand lowers to TokenTable by reusing the existing TokenInterner +
 * HandleMinter, so the emitted PdsDocument is shape-identical to what
 * normalize() produces from Figma (the symmetry payoff).
 *
 * Both halves ship together per module: the TypeScript interfaces the compiler
 * and its siblings consume, and the matching zod validators the prompt→DSL
 * layer runs model output through before calling compile(). Keeping a type
 * next to the schema that validates it is the whole reason the split below
 * follows the DSL's own layering rather than "types here, schemas there".
 *
 * The modules form a strict stack, each depending only on the ones above it:
 *
 *   scalars ── assets ── motion          (no DSL dependencies)
 *      └─ brand
 *           └─ blocks
 *                ├─ components
 *                └─ sections
 *                     └─ document
 *
 * Import from this barrel, not the modules, unless you are inside the DSL.
 */

export * from "./schema/scalars";
export * from "./schema/assets";
export * from "./schema/brand";
export * from "./schema/motion";
export * from "./schema/blocks";
export * from "./schema/components";
export * from "./schema/sections";
export * from "./schema/document";
