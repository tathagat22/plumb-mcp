/**
 * The Plumb Design Spec (PDS) — a normalized, deduplicated, CSS-shaped
 * representation of a Figma subtree, built for an LLM to read cheaply and
 * implement correctly. See plan §5.
 */

export type Flow = "row" | "col";

export interface PdsLayout {
  /** flex-direction */
  flow: Flow;
  /** itemSpacing → gap */
  gap?: number;
  /** counterAxisSpacing on a wrapping container */
  gapCross?: number;
  /** [top, right, bottom, left] */
  pad: [number, number, number, number];
  /** justify-content, omitted when default (flex-start) */
  justify?: string;
  /** align-items, omitted when default (flex-start) */
  align?: string;
  /** flex-wrap */
  wrap?: boolean;
}

export interface PdsNode {
  /** Raw Figma node id — stable across edits. */
  id: string;
  /** Stable, human-readable handle. The agent tags rendered DOM `data-plumb-id="<el>"`. */
  el: string;
  name: string;
  /** Simplified node type: frame | text | rect | ellipse | instance | ... */
  type: string;
  box: { w: number; h: number };
  layout?: PdsLayout;
  /**
   * Position relative to the parent's top-left, in CSS pixels. Emitted when
   * the parent has no auto-layout (so children are absolutely positioned)
   * or when the child overrides layout with Figma's "Absolute position"
   * toggle. Omitted when the parent's auto-layout resolves placement.
   */
  pos?: { x: number; y: number };
  /** Token ref into tokens.color, or "gradient" / "image". */
  fill?: string;
  stroke?: string;
  strokeW?: number;
  /** Token ref into tokens.radius, or a per-corner [tl,tr,br,bl] tuple. */
  radius?: string | [number, number, number, number];
  /** CSS box-shadow string. */
  shadow?: string;
  opacity?: number;
  clip?: boolean;
  /** Token ref into tokens.text (TEXT nodes only). */
  text?: string;
  /** The actual text content (TEXT nodes only). */
  chars?: string;
  /** mainComponent id (INSTANCE nodes only). */
  component?: string;
  /** Child `el` handles — present when this node's children are included. */
  children?: string[];
  /**
   * Set instead of `children` at the disclosure boundary: this many children
   * exist but were not included. Call plumb_node again on this node's `id`
   * to expand them (progressive disclosure, plan §5/§7).
   */
  more?: number;
  /** Opt-in human-readable hints (plan §7). */
  notes?: string[];
}

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
}

export interface PdsDocument {
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
  };
  /** Suggested next step for the agent (plan §6.1). */
  next: string;
}
