/**
 * Motion authoring — the write-direction mirror of the read-side reaction
 * serializer (figma-plugin/code.ts `serializeReactions` + normalize.ts
 * `motionFromReactions`).
 *
 * Two responsibilities, now split the way the blueprint's file map always
 * described them:
 *
 *   1. compile — DSL `interactions` / `DslPrototype` → PDS motion fields.
 *      `compileInteractions()` returns `AuthoredMotionSpec[]` (the read-side
 *      `MotionSpec` shape from src/pds.ts, plus the additive authoring fields
 *      the blueprint §9.9 merges into `MotionSpec`). The block lowerer assigns
 *      the result to `PdsNode.motion`; `compilePrototype()` produces the
 *      additive `PdsDocument.prototype`.
 *
 *   2. plan — `buildMotionPlan()` walks the assembled PDS and lowers every
 *      `node.motion` / `node.overflow` / `node.overlayCfg` / `doc.prototype`
 *      into the `MotionPlan` wire contract (blueprint §2) that rides
 *      `apply-motion` to the plugin executor (figma-plugin/motion-emit.ts).
 *
 * Symmetry: `AuthoredMotionSpec extends MotionSpec`, so the exact read-side
 * trigger/kind/easing string conventions are reused (e.g. `trigger:"ON_CLICK"`,
 * `kind:"SMART_ANIMATE"`, `easing:"cubic-bezier(...)"` / `"ease-out"`).
 *
 * This file is standalone: it imports only DSL types (./schema) and PDS types
 * (../pds). The wire contract below is the authoritative definition until the
 * integration agent lifts it into src/bridge/protocol.ts (see followups).
 */

export type * from "./motion/types";
export * from "./motion/compile";
export * from "./motion/plan";
