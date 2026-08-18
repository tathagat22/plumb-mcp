/**
 * The bridge's in-flight request bookkeeping.
 *
 * Every tool call that needs the plugin becomes a promise held open until a
 * reply with a matching `reqId` arrives — or until a watchdog decides one never
 * will. Three things make that harder than a plain map of promises, and all
 * three are the reason this is its own module rather than a corner of
 * `server.ts`:
 *
 *   - **Write operations take minutes, not seconds.** Applying a design to
 *     Figma is slow enough that a fixed timeout is either uselessly long for a
 *     read or uselessly short for a write. So the plugin sends `apply-progress`
 *     heartbeats and each one RE-ARMS the watchdog in place. The timeout means
 *     "no news for this long", not "not finished by this time".
 *   - **A reply can arrive after its watchdog fired.** That must be inert and
 *     visible, never a second resolve on a settled promise.
 *   - **A plugin can vanish mid-flight.** Every pending request then belongs to
 *     an answer nobody will ever send, and all of them have to reject at once
 *     rather than each waiting out its own timeout.
 *
 * All of it is testable here without a WebSocket: dispatch is a callback.
 */
import { PlumbError } from "../errors";
import { createLogger } from "../logger";
import type { ApplyProgressMessage } from "./protocol";

const log = createLogger("bridge.requests");

interface Pending {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  /** Reassignable: an apply-progress heartbeat resets the watchdog in place. */
  timer: ReturnType<typeof setTimeout>;
  /** ms — the timeout to re-arm on each heartbeat (write ops only). */
  timeoutMs: number;
  label: string;
}

const pending = new Map<string, Pending>();

/** Non-terminal apply-progress listeners, keyed by reqId (write ops only). */
const progressListeners = new Map<string, (p: ApplyProgressMessage) => void>();

let reqCounter = 0;

function timeoutError(label: string): PlumbError {
  return new PlumbError(
    `The Plumb plugin did not answer the ${label} request in time.`,
    "Make sure the plugin is still running and paired in Figma, then retry.",
  );
}

/** Arm (or re-arm) the watchdog for one request. */
function armWatchdog(
  reqId: string,
  timeoutMs: number,
  label: string,
  reject: (e: Error) => void,
): ReturnType<typeof setTimeout> {
  return setTimeout(() => {
    pending.delete(reqId);
    progressListeners.delete(reqId);
    reject(timeoutError(label));
  }, timeoutMs);
}

/**
 * Open a request: mint an id, arm the watchdog, hand the id to `dispatch` so
 * the caller can put it on the wire, and resolve when a matching reply lands.
 */
export function openRequest<T>(
  label: string,
  timeoutMs: number,
  dispatch: (reqId: string) => void,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const reqId = `r${++reqCounter}`;
    pending.set(reqId, {
      resolve: resolve as (v: unknown) => void,
      reject,
      timer: armWatchdog(reqId, timeoutMs, label, reject),
      timeoutMs,
      label,
    });
    dispatch(reqId);
  });
}

/** Settle a request with its reply. A reply for an unknown id is inert. */
export function resolvePending(reqId: string, value: unknown): void {
  const p = pending.get(reqId);
  if (!p) {
    // Arrived after the watchdog fired, or was never ours. Logged rather than
    // dropped silently, so a slow-but-eventual reply is distinguishable from a
    // genuine hang when debugging.
    log.warn("late reply — already timed out or unknown", { reqId });
    return;
  }
  clearTimeout(p.timer);
  pending.delete(reqId);
  progressListeners.delete(reqId);
  p.resolve(value);
}

/**
 * Reject everything in flight. Called when the plugin disconnects: only one
 * plugin pairs at a time, so every pending request belongs to an answer that
 * is now never coming.
 */
export function rejectAllPending(error: Error): void {
  for (const p of pending.values()) {
    clearTimeout(p.timer);
    p.reject(error);
  }
  pending.clear();
  progressListeners.clear();
}

/**
 * Record an `apply-progress` heartbeat: re-arm the watchdog and notify the
 * listener, WITHOUT settling the request. Returns false when the request is
 * already gone, which is how a late heartbeat stays harmless.
 */
export function heartbeat(msg: ApplyProgressMessage): boolean {
  const p = pending.get(msg.reqId);
  if (!p) return false;
  clearTimeout(p.timer);
  p.timer = armWatchdog(msg.reqId, p.timeoutMs, p.label, p.reject);
  progressListeners.get(msg.reqId)?.(msg);
  return true;
}

/** Attach a progress listener for a write operation (drives Studio). */
export function setProgressListener(
  reqId: string,
  fn: (p: ApplyProgressMessage) => void,
): void {
  progressListeners.set(reqId, fn);
}

export function clearProgressListener(reqId: string): void {
  progressListeners.delete(reqId);
}

/** How many requests are in flight. A number that only grows means a wedged
 *  plugin, which is why `/healthz` reports it. */
export function pendingCount(): number {
  return pending.size;
}

/** Drop everything without rejecting. For tests and for a clean shutdown, where
 *  the promises' owners are going away too. */
export function resetRequestQueue(): void {
  for (const p of pending.values()) clearTimeout(p.timer);
  pending.clear();
  progressListeners.clear();
}
