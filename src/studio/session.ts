/**
 * Studio session store — shared state for the step-by-step design flow.
 *
 * The transparent studio runs as a sequence of separate tool calls
 * (references+brand → component kit → composed pages), each landing on its own
 * named Figma page and reviewable between steps. Those calls need to share what
 * the first step already did — the synthesized brand, the discovered
 * references, and the reference screenshots already staged as assets — so later
 * steps don't re-capture the same URLs. This in-process store holds that state,
 * keyed by a session id handed back to the caller and passed into each step.
 *
 * Asset keys survive here because stageInboundAsset (bridge/server.ts) persists
 * captures in-process across tool calls: a key staged in step 1 is still
 * fetchable in step 3, so we keep the keys, not the bytes.
 */

import type { Reference } from "../brand/references";
// schema exports the DSL brand-colours shape as `BrandColors`; the studio/brand
// tools alias it to DslBrandColors, so we do the same for a matching contract.
import type { BrandColors as DslBrandColors, Component } from "../dsl/schema";

/** A reference screenshot already staged as a fetchable asset. */
export interface StudioCapture {
  url: string;
  assetKey: string;
  w: number;
  h: number;
}

export interface StudioSession {
  id: string;
  brief: string;
  /** deriveName(brief) — a short brand name. */
  name: string;
  /** Synthesized brand colours (the DSL brand.colors shape). */
  brand: DslBrandColors;
  refs: Reference[];
  /** Captures already staged via stageInboundAsset — keys reusable across steps. */
  captures: StudioCapture[];
  /** Set by plumb_studio_kit once the component library is built. */
  kit?: { components: Component[]; componentNames: string[] };
}

/** Keep only the most recent handful of sessions so the map can't grow forever. */
const MAX_SESSIONS = 20;

const sessions = new Map<string, StudioSession>();

/** Deterministic ids — no Math.random / Date. */
let counter = 0;

/** Evict the oldest entries once we're over the cap (Map preserves insertion order). */
function evictOldest(): void {
  while (sessions.size > MAX_SESSIONS) {
    const oldest = sessions.keys().next().value;
    if (oldest === undefined) break;
    sessions.delete(oldest);
  }
}

/** Create a fresh session, assign it an id, and store it. */
export function createSession(init: Omit<StudioSession, "id">): StudioSession {
  const id = `studio-${++counter}`;
  const session: StudioSession = { ...init, id };
  sessions.set(id, session);
  evictOldest();
  return session;
}

export function getSession(id: string): StudioSession | undefined {
  return sessions.get(id);
}

/** Merge a patch into an existing session. Returns undefined if unknown. */
export function updateSession(
  id: string,
  patch: Partial<StudioSession>,
): StudioSession | undefined {
  const current = sessions.get(id);
  if (!current) return undefined;
  // Never let a patch rewrite the id it's keyed by.
  const next: StudioSession = { ...current, ...patch, id: current.id };
  sessions.set(id, next);
  return next;
}
