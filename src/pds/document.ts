/**
 * The document: the interned token table every node refers into, and the
 * envelope carrying the flat node map, the schema version, and the hints that
 * tell an agent what to do next.
 */

import type { PdsLayout } from "./primitives";
import type { Effect, Fill } from "./paint";
import type { PdsPrototype } from "./motion";
import type { PdsNode } from "./node";

export interface TokenTable {
  color: Record<string, string>;
  text: Record<string, string>;
  /**
   * Pixel radii, or the literal string "full" for fully-rounded shapes (pill /
   * circle). Figma stores "fully rounded" as a giant sentinel integer
   * (`21243700`, `33990048`, …) — Plumb normalises those to "full" so an
   * agent never has to guess whether `21243700` is literal pixels.
   */
  radius: Record<string, number | "full">;
  shadow: Record<string, string>;
  /**
   * Compound token namespaces — v0.10. Each maps `$xN` → the structured
   * value previously emitted inline on every node. Only present when the
   * file actually contains repeating compounds; an empty namespace is
   * omitted rather than emitted as `{}`.
   *
   * Resolution rule for agents: when `node.layout` (or .effects/.fills/etc)
   * is a string, look it up here. When it's the literal value, use as-is.
   * Both shapes are valid in the same response.
   */
  layout?: Record<string, PdsLayout>;
  effects?: Record<string, Effect[]>;
  fills?: Record<string, Fill[]>;
  vector?: Record<string, string>;
  props?: Record<string, Record<string, string | boolean | number>>;
  /**
   * Per-ref hit counts (≥2 only) — measurable proof of dedup. Inspect
   * `tokens.meta.counts` to see which compounds are doing real work; useful
   * when comparing "tokens before / tokens after" on a real screen.
   */
  meta?: { counts?: Record<string, number> };
}

/**
 * PDS wire-shape version — independent of `plumb-mcp`'s own npm version
 * (`SERVER_VERSION`, src/meta.ts), which bumps on every release regardless
 * of whether the wire shape changed. Bump this only on an actual breaking
 * change to `PdsDocument`/`PdsNode`'s shape, so a client that snapshot-tests
 * its own parsing has something concrete to check against. Mirrors
 * `SemanticGraph.cirVersion`'s identical convention (src/semantic/graph.ts).
 */
export const PDS_SCHEMA_VERSION = "1.0.0";

export interface PdsDocument {
  /** See {@link PDS_SCHEMA_VERSION}. */
  schemaVersion: string;
  file: { name: string; version: string };
  /** `el` of the requested root node. */
  root: string;
  tokens: TokenTable;
  /** Flat map of `el` → node. Parents reference children by `el`. */
  nodes: Record<string, PdsNode>;
  meta: {
    nodeCount: number;
    estTokens: number;
    depthUsed: number;
    truncated?: boolean;
    hint?: string;
    /**
     * Likely typos in TEXT nodes — single-edit outliers from a dominant
     * sibling/cluster value. Conservative: only flagged when ≥3 nearby texts
     * agree and exactly one diverges by 1–2 edits. Designers ship typos all
     * the time and a faithful extractor preserves them; this hint surfaces
     * them so the agent can ask the user instead of silently shipping.
     */
    suspiciousText?: SuspiciousText[];
  };
  /** Suggested next step for the agent (plan §6.1). */
  next: string;
  /** File-level prototype flow config (additive, write direction). */
  prototype?: PdsPrototype;
}

export interface SuspiciousText {
  path: string;
  value: string;
  hint: string;
}
