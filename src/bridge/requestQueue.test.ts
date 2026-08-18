import { afterEach, describe, expect, it, vi } from "vitest";
import { PlumbError } from "../errors";
import type { ApplyProgressMessage } from "./protocol";
import {
  clearProgressListener,
  heartbeat,
  openRequest,
  pendingCount,
  rejectAllPending,
  resetRequestQueue,
  resolvePending,
  setProgressListener,
} from "./requestQueue";

/**
 * Every one of these paths existed before this module did — they were just
 * unreachable, tangled into a live WebSocketServer. They are also exactly the
 * paths that matter when something goes wrong: a watchdog that fires while a
 * reply is in flight, a heartbeat for a request that already timed out, a
 * plugin that disappears with six requests open.
 *
 * Fake timers throughout, so a 600-second write watchdog is a millisecond of
 * test time.
 */

const progress = (reqId: string, over: Partial<ApplyProgressMessage> = {}): ApplyProgressMessage =>
  ({ t: "apply-progress", reqId, done: 1, total: 10, ...over }) as ApplyProgressMessage;

afterEach(() => {
  resetRequestQueue();
  vi.useRealTimers();
});

describe("openRequest", () => {
  it("hands the caller a reqId to put on the wire", async () => {
    let seen: string | undefined;
    const promise = openRequest<string>("node", 1000, (reqId) => {
      seen = reqId;
    });
    expect(seen).toMatch(/^r\d+$/);
    resolvePending(seen!, "ok");
    await expect(promise).resolves.toBe("ok");
  });

  it("mints a distinct id per request", () => {
    const ids: string[] = [];
    openRequest("a", 1000, (id) => ids.push(id));
    openRequest("b", 1000, (id) => ids.push(id));
    expect(new Set(ids).size).toBe(2);
  });

  it("counts requests as in-flight until they settle", async () => {
    let id = "";
    const promise = openRequest<string>("node", 1000, (r) => (id = r));
    expect(pendingCount()).toBe(1);
    resolvePending(id, "done");
    await promise;
    expect(pendingCount()).toBe(0);
  });

  it("resolves with whatever the reply carried", async () => {
    let id = "";
    const promise = openRequest<{ n: number }>("node", 1000, (r) => (id = r));
    resolvePending(id, { n: 42 });
    await expect(promise).resolves.toEqual({ n: 42 });
  });
});

describe("the watchdog", () => {
  it("rejects with an instruction-shaped error once the timeout passes", async () => {
    vi.useFakeTimers();
    const promise = openRequest("screenshot", 5_000, () => {});
    vi.advanceTimersByTime(5_001);

    await expect(promise).rejects.toBeInstanceOf(PlumbError);
    await expect(promise).rejects.toThrow(/did not answer the screenshot request/);
  });

  it("names the operation, so the message says what actually hung", async () => {
    vi.useFakeTimers();
    const promise = openRequest("apply-design", 1_000, () => {});
    vi.advanceTimersByTime(1_001);
    await expect(promise).rejects.toThrow(/apply-design/);
  });

  it("carries a nextAction — an error here is an instruction, not a code", async () => {
    vi.useFakeTimers();
    const promise = openRequest("node", 1_000, () => {});
    vi.advanceTimersByTime(1_001);
    await promise.catch((e: unknown) => {
      expect((e as PlumbError).nextAction).toMatch(/plugin/i);
    });
  });

  it("does not fire early", async () => {
    vi.useFakeTimers();
    let id = "";
    const promise = openRequest<string>("node", 5_000, (r) => (id = r));
    vi.advanceTimersByTime(4_999);
    resolvePending(id, "just in time");
    await expect(promise).resolves.toBe("just in time");
  });

  it("stops counting the request once it fires", async () => {
    vi.useFakeTimers();
    const promise = openRequest("node", 1_000, () => {});
    vi.advanceTimersByTime(1_001);
    await promise.catch(() => {});
    expect(pendingCount()).toBe(0);
  });

  it("cannot fire after the reply landed", async () => {
    vi.useFakeTimers();
    let id = "";
    const promise = openRequest<string>("node", 1_000, (r) => (id = r));
    resolvePending(id, "ok");
    await expect(promise).resolves.toBe("ok");
    // The timer must have been cleared; advancing past it settles nothing.
    expect(() => vi.advanceTimersByTime(10_000)).not.toThrow();
  });
});

describe("apply-progress heartbeats", () => {
  it("re-arms the watchdog instead of settling the request", async () => {
    // The core property: a long write does not time out while it is making
    // progress. The timeout means "no news for this long", not "not finished
    // by this time".
    vi.useFakeTimers();
    let id = "";
    const promise = openRequest<string>("apply-design", 1_000, (r) => (id = r));

    for (let i = 0; i < 5; i += 1) {
      vi.advanceTimersByTime(900);
      expect(heartbeat(progress(id))).toBe(true);
    }
    // 4.5s elapsed against a 1s timeout, still alive.
    expect(pendingCount()).toBe(1);

    resolvePending(id, "applied");
    await expect(promise).resolves.toBe("applied");
  });

  it("still times out once the heartbeats stop", async () => {
    vi.useFakeTimers();
    let id = "";
    const promise = openRequest("apply-design", 1_000, (r) => (id = r));
    vi.advanceTimersByTime(900);
    heartbeat(progress(id));
    vi.advanceTimersByTime(1_001);
    await expect(promise).rejects.toThrow(/did not answer/);
  });

  it("notifies the listener with the progress payload", () => {
    let id = "";
    const seen: ApplyProgressMessage[] = [];
    openRequest("apply-design", 1_000, (r) => (id = r));
    setProgressListener(id, (p) => seen.push(p));

    heartbeat(progress(id, { done: 3, total: 10 }));
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ done: 3, total: 10 });
  });

  it("reports false for a heartbeat on an unknown request", () => {
    // A heartbeat arriving after the watchdog already fired must be inert.
    expect(heartbeat(progress("r-never-existed"))).toBe(false);
  });

  it("stops notifying once the listener is cleared", () => {
    let id = "";
    const seen: ApplyProgressMessage[] = [];
    openRequest("apply-design", 1_000, (r) => (id = r));
    setProgressListener(id, (p) => seen.push(p));
    clearProgressListener(id);
    heartbeat(progress(id));
    expect(seen).toEqual([]);
  });

  it("drops the listener when the request settles", async () => {
    let id = "";
    const seen: ApplyProgressMessage[] = [];
    const promise = openRequest<string>("apply-design", 1_000, (r) => (id = r));
    setProgressListener(id, (p) => seen.push(p));
    resolvePending(id, "done");
    await promise;

    heartbeat(progress(id));
    expect(seen).toEqual([]);
  });
});

describe("a late or unknown reply", () => {
  it("is inert rather than throwing", () => {
    expect(() => resolvePending("r-never-existed", "value")).not.toThrow();
  });

  it("cannot settle a request twice", async () => {
    let id = "";
    const promise = openRequest<string>("node", 1_000, (r) => (id = r));
    resolvePending(id, "first");
    resolvePending(id, "second");
    await expect(promise).resolves.toBe("first");
  });
});

describe("rejectAllPending", () => {
  it("rejects every in-flight request with the same error", async () => {
    // What a plugin disconnect looks like: only one plugin pairs at a time, so
    // everything open belongs to an answer that is never coming.
    const promises = [
      openRequest("a", 60_000, () => {}),
      openRequest("b", 60_000, () => {}),
      openRequest("c", 60_000, () => {}),
    ].map((p) => p.catch((e: unknown) => (e as Error).message));

    expect(pendingCount()).toBe(3);
    rejectAllPending(new Error("plugin disconnected"));

    expect(await Promise.all(promises)).toEqual([
      "plugin disconnected",
      "plugin disconnected",
      "plugin disconnected",
    ]);
    expect(pendingCount()).toBe(0);
  });

  it("clears the watchdogs too, so nothing fires afterwards", async () => {
    vi.useFakeTimers();
    const promise = openRequest("a", 1_000, () => {}).catch((e: unknown) => (e as Error).message);
    rejectAllPending(new Error("gone"));
    vi.advanceTimersByTime(10_000);
    expect(await promise).toBe("gone");
  });

  it("is a no-op with nothing in flight", () => {
    expect(() => rejectAllPending(new Error("x"))).not.toThrow();
    expect(pendingCount()).toBe(0);
  });
});

describe("resetRequestQueue", () => {
  it("drops everything without rejecting", async () => {
    vi.useFakeTimers();
    let settled = false;
    void openRequest("a", 1_000, () => {}).then(
      () => (settled = true),
      () => (settled = true),
    );

    resetRequestQueue();
    expect(pendingCount()).toBe(0);

    // The watchdog was cleared, so the promise simply never settles — which is
    // fine, because a reset happens when its owner is going away too.
    vi.advanceTimersByTime(10_000);
    await Promise.resolve();
    expect(settled).toBe(false);
  });
});
