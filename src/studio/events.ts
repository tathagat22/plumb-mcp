/**
 * Plumb Studio event bus.
 *
 * The MCP server is the hub — it sees every tool call the agent makes. Tools
 * emit lightweight {@link StudioEvent}s here; the bridge subscribes each
 * connected Studio UI and forwards them over WebSocket. A small ring buffer
 * lets a UI that connects mid-session replay recent activity.
 *
 * Pure JSON, no I/O — safe to import from any tool handler.
 */
import { EventEmitter } from "node:events";

export interface StudioDelta {
  el: string;
  kind: string;
  severity: string;
}

export interface StudioEvent {
  /** Epoch ms (server clock). */
  t: number;
  /** What kind of activity this is. */
  kind: "tool" | "fit" | "screen" | "screenshot" | "log";
  /** The MCP tool that produced it, when applicable. */
  tool?: string;
  /** Screen / node name in play. */
  screen?: string | null;
  /** One-line human summary for the timeline. */
  summary?: string;
  /** fit/verify: 0–100 convergence score. */
  score?: number;
  /** fit: loop reached the acceptance bar. */
  done?: boolean;
  matched?: number;
  importantMatched?: number;
  importantTotal?: number;
  /** fit/verify: top deltas still outstanding. */
  deltas?: StudioDelta[];
  /** Which drive surface, when relevant: "mirror" | "drive". */
  via?: string;
}

const bus = new EventEmitter();
bus.setMaxListeners(64);

const RING_MAX = 200;
const ring: StudioEvent[] = [];

/** Emit a Studio event. Tools call this; the bridge fans it out to UIs. */
export function emitStudio(event: Omit<StudioEvent, "t"> & { t?: number }): void {
  const ev: StudioEvent = { t: event.t ?? Date.now(), ...event };
  ring.push(ev);
  if (ring.length > RING_MAX) ring.shift();
  bus.emit("event", ev);
}

/** Subscribe to live events. Returns an unsubscribe fn. */
export function onStudio(fn: (e: StudioEvent) => void): () => void {
  bus.on("event", fn);
  return () => bus.off("event", fn);
}

/** The recent backlog, for a UI that just connected. */
export function recentStudio(): StudioEvent[] {
  return ring.slice();
}
