/**
 * Plumb Design DSL — public barrel.
 *
 * The write-path entrypoint: import `{ compile }` to lower a validated
 * DesignDoc to PDS, `DesignDocSchema` to validate model output first, and
 * `registerSection` to extend the semantic section vocabulary.
 */

// Types + validators (authoritative source of truth).
export * from "./schema";

// Compiler entrypoint + result shapes.
export { compile } from "./compile";
export type { CompileContext, CompileResult } from "./compile";

// Section registry (pluggable semantic roles).
export { registerSection, lowerSection } from "./sections";
export type { SectionCtx, SectionLowerer } from "./sections";

// Token lowering (Brand → TokenTable).
export { TokenCtx, hexToRgba01 } from "./tokens";

// Block lowering internals (asset key helpers reused by the asset engine).
export { assetCacheKey, normalizeAssetSpec, buttonToStack } from "./blocks";
export type { LowerCtx, Lowered } from "./blocks";

// Component expansion.
export { expandInstance, indexComponents } from "./components";
export type { ComponentSidecar } from "./components";

// Motion authoring compile/plan (interactions → MotionSpec[] → MotionPlan).
export {
  buildMotionPlan,
  compileInteraction,
  compileInteractions,
  compileOverlayCfg,
  compilePrototype,
  isEmptyMotionPlan,
} from "./motion";
export type {
  AuthoredMotionSpec,
  MotionPlan,
  MotionResult,
  PdsOverlayCfg,
  PdsPrototype,
} from "./motion";

// Worked examples (importable for tests / demos / docs).
export { landingDoc } from "./examples/landing";
export { featureCardDoc } from "./examples/feature-card";
