/**
 * The Plumb Design Spec (PDS) — a normalized, deduplicated, CSS-shaped
 * representation of a Figma subtree, built for an LLM to read cheaply and
 * implement correctly. See plan §5.
 */

/*
 * Split by concern under `pds/`, and re-exported here so every consumer keeps
 * importing from `./pds`:
 *
 *   primitives.ts  flow, layout, repeat groups, text runs
 *   paint.ts       fills, gradients, images, effects
 *   motion.ts      interaction specs, overlays, the prototype flow
 *   node.ts        PdsNode — the type consumers actually live in
 *   document.ts    the token table and the document envelope
 */

export type * from "./pds/primitives";
export type * from "./pds/paint";
export type * from "./pds/motion";
export type * from "./pds/node";
export type * from "./pds/document";
export { PDS_SCHEMA_VERSION } from "./pds/document";
