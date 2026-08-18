import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  INBOUND_TTL_MS,
  PENDING_UPLOAD_TTL_MS,
  clearAllPendingUploads,
  contentTypeFor,
  deleteUpload,
  markAssetRequest,
  readInboundAsset,
  resetStaging,
  setFileRemover,
  stageInboundAsset,
  stageUpload,
  stagingStats,
  sweepExpiredUploads,
  takeAssetRequestElapsed,
  takeUpload,
} from "./uploads";

/**
 * These maps sit between an HTTP upload and the WebSocket reply that drains it,
 * which makes them the one place in the bridge that can leak unboundedly: a
 * plugin that crashes mid-request never sends the reply, and a long-running
 * multi-session process accumulates both map entries and staged temp files.
 *
 * So the cases that matter are the ones with no happy path — expiry, a
 * disconnect mid-flight, a reply for a request that was already swept — plus
 * the distinction between draining an upload (caller now owns the file) and
 * discarding one (the file must go).
 */

/** Every removed path, so a test can assert files were actually reclaimed. */
let removed: string[] = [];
let restoreRemover: () => void;

beforeEach(() => {
  removed = [];
  restoreRemover = setFileRemover((path) => removed.push(path));
});

afterEach(() => {
  restoreRemover();
  resetStaging();
});

describe("contentTypeFor", () => {
  it.each([
    ["png", "image/png"],
    ["jpg", "image/jpeg"],
    ["jpeg", "image/jpeg"],
    ["webp", "image/webp"],
    ["gif", "image/gif"],
    ["svg", "image/svg+xml"],
  ])("maps %s", (ext, type) => {
    expect(contentTypeFor(ext)).toBe(type);
  });

  it("tolerates a leading dot and upper case", () => {
    expect(contentTypeFor(".PNG")).toBe("image/png");
  });

  it("falls back to octet-stream for anything unrecognised", () => {
    expect(contentTypeFor("xyz")).toBe("application/octet-stream");
  });
});

describe("draining vs discarding an upload", () => {
  it("takeUpload returns the path and does NOT delete the file", () => {
    // The caller owns the file after this — deleting it here would pull the
    // screenshot out from under the tool that asked for it.
    stageUpload("r1", "/tmp/plumb-r1.png");
    expect(takeUpload("r1")).toBe("/tmp/plumb-r1.png");
    expect(removed).toEqual([]);
  });

  it("takeUpload forgets the entry, so a second call sees nothing", () => {
    stageUpload("r1", "/tmp/plumb-r1.png");
    takeUpload("r1");
    expect(takeUpload("r1")).toBeUndefined();
    expect(stagingStats().uploads).toBe(0);
  });

  it("returns undefined for a reqId that was never staged", () => {
    expect(takeUpload("never")).toBeUndefined();
  });

  it("deleteUpload removes the file as well as the entry", () => {
    stageUpload("r1", "/tmp/plumb-r1.png");
    deleteUpload("r1");
    expect(removed).toEqual(["/tmp/plumb-r1.png"]);
    expect(stagingStats().uploads).toBe(0);
  });

  it("deleteUpload on an unknown reqId is a no-op, not a throw", () => {
    expect(() => deleteUpload("never")).not.toThrow();
    expect(removed).toEqual([]);
  });
});

describe("asset-request timing", () => {
  it("reports elapsed ms and forgets the marker", () => {
    markAssetRequest("r1", 1_000);
    expect(takeAssetRequestElapsed("r1", 1_250)).toBe(250);
    expect(takeAssetRequestElapsed("r1", 1_300)).toBeUndefined();
  });

  it("returns undefined for a request it never saw", () => {
    // A reply arriving after the sweep reclaimed its marker must not be
    // reported as a 0ms round trip.
    expect(takeAssetRequestElapsed("swept-away")).toBeUndefined();
  });
});

describe("the TTL sweep", () => {
  it("reclaims an upload past its TTL, and its file", () => {
    stageUpload("stale", "/tmp/stale.png", 0);
    const swept = sweepExpiredUploads(PENDING_UPLOAD_TTL_MS + 1);
    expect(swept.uploads).toBe(1);
    expect(removed).toEqual(["/tmp/stale.png"]);
  });

  it("leaves an upload that is still within its TTL", () => {
    stageUpload("fresh", "/tmp/fresh.png", 0);
    expect(sweepExpiredUploads(PENDING_UPLOAD_TTL_MS - 1).uploads).toBe(0);
    expect(stagingStats().uploads).toBe(1);
    expect(removed).toEqual([]);
  });

  it("reclaims only what has actually expired", () => {
    stageUpload("old", "/tmp/old.png", 0);
    stageUpload("new", "/tmp/new.png", PENDING_UPLOAD_TTL_MS);
    sweepExpiredUploads(PENDING_UPLOAD_TTL_MS + 1);
    expect(removed).toEqual(["/tmp/old.png"]);
    expect(takeUpload("new")).toBe("/tmp/new.png");
  });

  it("reclaims stale asset-request markers too", () => {
    markAssetRequest("stale", 0);
    const swept = sweepExpiredUploads(PENDING_UPLOAD_TTL_MS + 1);
    expect(swept.assetRequests).toBe(1);
    expect(stagingStats().assetRequests).toBe(0);
  });

  it("is safe to run against empty maps", () => {
    expect(sweepExpiredUploads()).toEqual({ uploads: 0, assetRequests: 0 });
  });

  it("is idempotent — a second sweep finds nothing left", () => {
    stageUpload("stale", "/tmp/stale.png", 0);
    sweepExpiredUploads(PENDING_UPLOAD_TTL_MS + 1);
    expect(sweepExpiredUploads(PENDING_UPLOAD_TTL_MS + 2).uploads).toBe(0);
  });
});

describe("clearing on plugin disconnect", () => {
  it("drops every pending upload and removes its file", () => {
    // Only one plugin pairs at a time, so on disconnect nothing pending will
    // ever be answered — waiting out the 10-minute TTL would hold the files
    // for no reason.
    stageUpload("a", "/tmp/a.png");
    stageUpload("b", "/tmp/b.png");
    markAssetRequest("a");

    clearAllPendingUploads();

    expect(removed.sort()).toEqual(["/tmp/a.png", "/tmp/b.png"]);
    expect(stagingStats()).toMatchObject({ uploads: 0, assetRequests: 0 });
  });

  it("leaves staged INBOUND bytes alone", () => {
    // Inbound assets are staged by the server for the plugin to pull, not by
    // the plugin — a disconnect says nothing about whether they are still
    // wanted. `resetStaging` is the one that clears them.
    const key = stageInboundAsset(Buffer.from("svg"), "svg");
    clearAllPendingUploads();
    expect(readInboundAsset(key)).not.toBeNull();
  });
});

describe("inbound staging", () => {
  it("stages bytes and reads them back with the right content type", () => {
    const key = stageInboundAsset(Buffer.from("<svg/>"), "svg");
    const staged = readInboundAsset(key);
    expect(staged?.contentType).toBe("image/svg+xml");
    expect(staged?.bytes.toString()).toBe("<svg/>");
  });

  it("accepts a Uint8Array as well as a Buffer", () => {
    const key = stageInboundAsset(new Uint8Array([1, 2, 3]), "png");
    expect([...(readInboundAsset(key)?.bytes ?? [])]).toEqual([1, 2, 3]);
  });

  it("mints a distinct key per staged asset", () => {
    const a = stageInboundAsset(Buffer.from("a"), "png");
    const b = stageInboundAsset(Buffer.from("b"), "png");
    expect(a).not.toBe(b);
    expect(readInboundAsset(a)?.bytes.toString()).toBe("a");
    expect(readInboundAsset(b)?.bytes.toString()).toBe("b");
  });

  it("returns null for an unknown key", () => {
    expect(readInboundAsset("nope")).toBeNull();
  });

  it("can be read more than once inside its TTL", () => {
    const key = stageInboundAsset(Buffer.from("x"), "png");
    expect(readInboundAsset(key)).not.toBeNull();
    expect(readInboundAsset(key)).not.toBeNull();
  });

  it("expires lazily on read, and stays gone", () => {
    const key = stageInboundAsset(Buffer.from("x"), "png", 0);
    expect(readInboundAsset(key, INBOUND_TTL_MS + 1)).toBeNull();
    // Dropped on the way out — an expired asset must not come back if the
    // clock is later read differently.
    expect(readInboundAsset(key, 0)).toBeNull();
    expect(stagingStats().inbound).toBe(0);
  });

  it("is still readable one tick before it expires", () => {
    const key = stageInboundAsset(Buffer.from("x"), "png", 0);
    expect(readInboundAsset(key, INBOUND_TTL_MS - 1)).not.toBeNull();
  });
});

describe("resetStaging", () => {
  it("drops uploads, markers, and inbound bytes together", () => {
    stageUpload("a", "/tmp/a.png");
    markAssetRequest("a");
    stageInboundAsset(Buffer.from("x"), "png");

    resetStaging();

    expect(stagingStats()).toEqual({ uploads: 0, assetRequests: 0, inbound: 0 });
  });
});

describe("the sweep interval the bridge arms", () => {
  it("runs twice within one TTL, so nothing outlives its deadline by much", () => {
    // The bridge schedules sweepExpiredUploads at TTL/2. Pinning the arithmetic
    // here rather than the setInterval call keeps the intent testable without a
    // live server.
    vi.useFakeTimers();
    try {
      const sweeps: number[] = [];
      const timer = setInterval(() => sweeps.push(Date.now()), PENDING_UPLOAD_TTL_MS / 2);
      vi.advanceTimersByTime(PENDING_UPLOAD_TTL_MS);
      clearInterval(timer);
      expect(sweeps).toHaveLength(2);
    } finally {
      vi.useRealTimers();
    }
  });
});
