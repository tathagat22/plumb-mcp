// Mirrors src/studio/events.ts StudioEvent (kept local so the browser bundle
// stays free of the server's node:events import).
export interface StudioDelta {
  el: string;
  kind: string;
  severity: string;
}

export interface StudioEvent {
  t: number;
  kind: "tool" | "fit" | "screen" | "screenshot" | "log";
  tool?: string;
  screen?: string | null;
  summary?: string;
  score?: number;
  done?: boolean;
  matched?: number;
  importantMatched?: number;
  importantTotal?: number;
  deltas?: StudioDelta[];
  via?: string;
}

export type Incoming =
  | { t: "studio-hello"; serverVersion: string; backlog: StudioEvent[] }
  | { t: "studio-event"; event: StudioEvent };
