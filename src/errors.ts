/**
 * A Plumb error always carries a `nextAction` — a literal, executable step the
 * agent or user can take. Plan §6.6: errors are instructions, not codes.
 */
export class PlumbError extends Error {
  readonly nextAction: string;

  constructor(message: string, nextAction: string) {
    super(message);
    this.name = "PlumbError";
    this.nextAction = nextAction;
  }
}

/** Shape returned to the agent when a tool fails. */
export interface PlumbErrorPayload {
  error: string;
  nextAction: string;
}

export function toErrorPayload(e: unknown): PlumbErrorPayload {
  if (e instanceof PlumbError) {
    return { error: e.message, nextAction: e.nextAction };
  }
  return {
    error: e instanceof Error ? e.message : String(e),
    nextAction: "Unexpected failure — retry; if it persists, open an issue with this message.",
  };
}
