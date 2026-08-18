/**
 * Binary staging for the bridge, in both directions.
 *
 * Screenshots and exported assets never travel over the WebSocket as base64 —
 * they go over HTTP, which means the bridge has to hold bytes and temp-file
 * paths between the moment they arrive and the moment the matching WS reply
 * drains them. That "between" is where leaks live: a plugin that crashes or
 * reloads mid-request never sends the reply, and without a backstop both maps
 * and their staged temp files grow for the life of the process.
 *
 * Pulling this out of `server.ts` gives that state one owner and, more to the
 * point, makes it testable: the TTL sweep, the disconnect purge, and the
 * lazy expiry on read are all pure map operations here, where they were
 * previously reachable only through a live WebSocketServer.
 */
import { unlink } from "node:fs";

/** How long an un-drained upload or in-flight asset request may linger before
 *  the sweep reclaims it. Covers the plugin crashing or reloading mid-request,
 *  when nothing ever arrives to drain these maps on their normal path. */
export const PENDING_UPLOAD_TTL_MS = 10 * 60 * 1000;

/** How long staged inbound bytes wait for the plugin to pull them. */
export const INBOUND_TTL_MS = 10 * 60 * 1000;

const EXT_CONTENT_TYPE: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
  svg: "image/svg+xml",
};

/** Content type for a file extension, with or without a leading dot. */
export function contentTypeFor(ext: string): string {
  return EXT_CONTENT_TYPE[ext.toLowerCase().replace(/^\./, "")] ?? "application/octet-stream";
}

/* ------------------------------------------------------- outbound uploads -- */

/** reqId → path the plugin's binary upload was written to. Drained when the
 *  matching `screenshot` WS reply arrives, so the resolved promise can carry
 *  the on-disk path instead of a base64 string. */
const uploadMap = new Map<string, { path: string; expires: number }>();

/** reqId → when the asset request was sent, for the round-trip timing log. */
const assetRequestStart = new Map<string, number>();

/** Remove the file from disk. Swappable so tests don't touch the filesystem. */
let removeFile: (path: string) => void = (path) => {
  // Best-effort: a leftover temp file is a leak, not a correctness problem.
  unlink(path, () => {});
};

/** Replace the unlink implementation. Returns a function restoring the previous
 *  one. Test seam only. */
export function setFileRemover(fn: (path: string) => void): () => void {
  const previous = removeFile;
  removeFile = fn;
  return () => {
    removeFile = previous;
  };
}

/** Record where an inbound upload landed, starting its TTL. */
export function stageUpload(reqId: string, path: string, now = Date.now()): void {
  uploadMap.set(reqId, { path, expires: now + PENDING_UPLOAD_TTL_MS });
}

/** Drain an upload: returns its path and forgets it, WITHOUT deleting the file
 *  — the caller now owns it. Returns undefined if nothing was staged. */
export function takeUpload(reqId: string): string | undefined {
  const upload = uploadMap.get(reqId);
  if (!upload) return undefined;
  uploadMap.delete(reqId);
  return upload.path;
}

/** Discard an upload and remove its file. For the paths where nobody will ever
 *  collect it. */
export function deleteUpload(reqId: string): void {
  const upload = uploadMap.get(reqId);
  if (!upload) return;
  uploadMap.delete(reqId);
  removeFile(upload.path);
}

/** Note that an asset request went out, for round-trip timing. */
export function markAssetRequest(reqId: string, now = Date.now()): void {
  assetRequestStart.set(reqId, now);
}

/** Elapsed ms since the matching {@link markAssetRequest}, or undefined if the
 *  request is unknown (already swept, or never sent). Forgets it either way. */
export function takeAssetRequestElapsed(reqId: string, now = Date.now()): number | undefined {
  const startedAt = assetRequestStart.get(reqId);
  assetRequestStart.delete(reqId);
  return startedAt === undefined ? undefined : now - startedAt;
}

/**
 * Periodic backstop: reclaims uploads and asset-request markers whose matching
 * WS reply is never going to arrive, because the plugin died without a clean
 * disconnect. Returns what it reclaimed, so a caller can log or assert on it.
 */
export function sweepExpiredUploads(now = Date.now()): {
  uploads: number;
  assetRequests: number;
} {
  let uploads = 0;
  for (const [reqId, upload] of uploadMap) {
    if (upload.expires < now) {
      deleteUpload(reqId);
      uploads += 1;
    }
  }
  let assetRequests = 0;
  for (const [reqId, startedAt] of assetRequestStart) {
    if (now - startedAt > PENDING_UPLOAD_TTL_MS) {
      assetRequestStart.delete(reqId);
      assetRequests += 1;
    }
  }
  return { uploads, assetRequests };
}

/**
 * Only one plugin is ever paired at a time, so when it disconnects every
 * pending upload and asset request belongs to a request that plugin will now
 * never answer. Clear both immediately rather than waiting out the TTL; a
 * fresh pairing starts with fresh reqIds regardless.
 */
export function clearAllPendingUploads(): void {
  for (const reqId of [...uploadMap.keys()]) deleteUpload(reqId);
  assetRequestStart.clear();
}

/* -------------------------------------------------------- inbound staging -- */

/** Staged inbound asset bytes the plugin pulls via GET /asset/:key.:ext. */
const inbound = new Map<string, { bytes: Buffer; contentType: string; expires: number }>();
let inboundCounter = 0;

export interface StagedAsset {
  bytes: Buffer;
  contentType: string;
}

/**
 * Stage bytes for the plugin to pull, and return the key it pulls them by.
 * The asset engine's `inbound.registerAsset` delegates here, so there is one
 * home for the map and the HTTP route that reads it.
 */
export function stageInboundAsset(
  bytes: Buffer | Uint8Array,
  ext: string,
  now = Date.now(),
): string {
  const key = `a${++inboundCounter}${now.toString(36)}`;
  inbound.set(key, {
    bytes: Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes),
    contentType: contentTypeFor(ext),
    expires: now + INBOUND_TTL_MS,
  });
  return key;
}

/**
 * Read staged bytes, expiring them lazily. Returns null for an unknown key and
 * for one whose TTL has passed — an expired entry is dropped on the way out, so
 * a key that is never read still gets collected but a key that IS read cannot
 * come back from the dead.
 */
export function readInboundAsset(key: string, now = Date.now()): StagedAsset | null {
  const staged = inbound.get(key);
  if (!staged) return null;
  if (staged.expires < now) {
    inbound.delete(key);
    return null;
  }
  return { bytes: staged.bytes, contentType: staged.contentType };
}

/** Counts of everything currently held. For `/healthz` and for tests. */
export function stagingStats(): { uploads: number; assetRequests: number; inbound: number } {
  return { uploads: uploadMap.size, assetRequests: assetRequestStart.size, inbound: inbound.size };
}

/** Drop everything, including staged inbound bytes. Used when the bridge stops
 *  so one test's state cannot leak into the next. */
export function resetStaging(): void {
  clearAllPendingUploads();
  inbound.clear();
}
