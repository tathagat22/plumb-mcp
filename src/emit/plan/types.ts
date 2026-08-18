/**
 * Options and shared helpers for lowering a PDS into an `EmitPlan`.
 *
 * Their own module because the entry point and the asset builder both need
 * them, and putting them in either one makes the two import each other.
 */

import type { EmitAsset, EmitTarget } from "../../bridge/protocol";

/** Extra per-asset info the caller (asset engine) supplies so image/svg fills
 *  can ship bytes. Keyed by `PdsNode.assetId` (== the inbound stage key). */
export interface LowerAssetInfo {
  ext: EmitAsset["ext"];
  kind: EmitAsset["kind"];
  svgInline?: string;
  w?: number;
  h?: number;
}

export interface LowerOptions {
  planId: string;
  target: EmitTarget;
  mode: "create" | "sync";
  prune?: boolean;
  reveal?: boolean;
  /** Compiler component sidecar — carried for parity; not required. */
  components?: Record<string, { id: string; el: string; props: unknown[] }>;
  /** PdsNode.assetId → staged asset info (ext/kind/bytes-location). */
  assets?: Record<string, LowerAssetInfo>;
}

/** Two decimal places. Figma stores full float precision; a plan carrying
 *  `12.000000000000002` is noise in every diff that ever touches it. */
export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
