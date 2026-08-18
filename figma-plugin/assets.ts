/// <reference types="@figma/plugin-typings" />

/**
 * Assets — exporting icons as SVG and images as PNG, and shipping the bytes.
 *
 * Bytes go over HTTP to the bridge's `/upload/:key.:ext`, never over the
 * WebSocket as base64: Figma's IPC redelivers rapid postMessages, so array
 * uploads are serialised behind a per-item ack.
 */

/* ------------------------------------------------------------------ */
/* Assets — export icons (SVG) and images (PNG)                        */
/* ------------------------------------------------------------------ */

export interface WireAsset {
  id: string;
  name: string;
  format: "SVG" | "PNG" | "JPG" | "GIF" | "WEBP";
  /** Bridge fills this in from the HTTP upload — plugin always sends null. */
  path: null;
  /** The id of the nearest ancestor that was also exported. */
  parentId?: string;
}

const VECTOR_TYPES = ["VECTOR", "BOOLEAN_OPERATION", "STAR", "LINE", "POLYGON"];
const CONTAINER_TYPES = ["FRAME", "GROUP", "INSTANCE", "COMPONENT"];
const MAX_ASSETS = 300;

export function hasImageFill(n: any): boolean {
  return (
    Array.isArray(n.fills) &&
    n.fills.some((f: any) => f && f.type === "IMAGE" && f.visible !== false)
  );
}

/** Returns the `imageHash` of the first visible IMAGE fill, or null. The hash
 *  is the key into `figma.getImageByHash()` — i.e. the original uploaded
 *  bytes, not a rasterisation. */
export function firstImageHash(n: any): string | null {
  if (!Array.isArray(n.fills)) return null;
  for (const f of n.fills) {
    if (f && f.type === "IMAGE" && f.visible !== false && typeof f.imageHash === "string") {
      return f.imageHash;
    }
  }
  return null;
}

/** Detect the on-the-wire format of raw image bytes from their magic numbers
 *  so the bridge writes the right file extension. Falls back to PNG if the
 *  signature is unrecognised (Figma's image fills are virtually always one of
 *  PNG / JPG / GIF / WEBP). */
export function detectImageFormat(bytes: Uint8Array): "PNG" | "JPG" | "GIF" | "WEBP" {
  if (bytes.length >= 4) {
    // JPEG: FF D8 FF ..
    if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "JPG";
    // PNG: 89 50 4E 47 ..
    if (
      bytes[0] === 0x89 && bytes[1] === 0x50 &&
      bytes[2] === 0x4e && bytes[3] === 0x47
    ) return "PNG";
    // GIF: "GIF8"
    if (
      bytes[0] === 0x47 && bytes[1] === 0x49 &&
      bytes[2] === 0x46 && bytes[3] === 0x38
    ) return "GIF";
    // WEBP: "RIFF" .... "WEBP" at offset 8
    if (
      bytes.length >= 12 &&
      bytes[0] === 0x52 && bytes[1] === 0x49 &&
      bytes[2] === 0x46 && bytes[3] === 0x46 &&
      bytes[8] === 0x57 && bytes[9] === 0x45 &&
      bytes[10] === 0x42 && bytes[11] === 0x50
    ) return "WEBP";
  }
  return "PNG";
}

/** A container counts as an icon/illustration: vector art, no text, bounded. */
export function isIconSubtree(n: any): boolean {
  let count = 0;
  let hasVector = false;
  let ok = true;
  function walk(x: any): void {
    if (!ok) return;
    if (++count > 200) { ok = false; return; }
    if (x.type === "TEXT" || hasImageFill(x)) { ok = false; return; }
    if (VECTOR_TYPES.indexOf(x.type) !== -1) hasVector = true;
    if (Array.isArray(x.children)) for (const c of x.children) walk(c);
  }
  walk(n);
  return ok && hasVector;
}

/** Designer-created GROUP nodes are intentional groupings — export the whole
 *  group as one SVG whenever it contains vectors and no text, regardless of
 *  size. This preserves multi-layer icon groups instead of fragmenting them. */
export function isVectorGroup(n: any): boolean {
  if (n.type !== "GROUP") return false;
  let hasVector = false;
  let hasText = false;
  function walk(x: any): void {
    if (hasText) return;
    if (x.type === "TEXT") { hasText = true; return; }
    if (VECTOR_TYPES.indexOf(x.type) !== -1) hasVector = true;
    if (Array.isArray(x.children)) for (const c of x.children) walk(c);
  }
  walk(n);
  return hasVector && !hasText;
}

export function settingsFormat(n: any): "SVG" | "PNG" {
  if (Array.isArray(n.exportSettings)) {
    for (const s of n.exportSettings) if (s && s.format === "SVG") return "SVG";
  }
  return "PNG";
}

/** ackKey (`${reqId}-${index}`) → resolver that fires when the UI confirms
 *  the matching /upload POST completed. Serialising on this ack keeps Figma's
 *  postMessage IPC from buffering 100+ Uint8Arrays and redelivering them. */
export const uploadAcks = new Map<string, (error: string | null) => void>();

/** Ship a Uint8Array up to the bridge over the HTTP binary-upload channel.
 *  Awaits the per-item ack so Figma's IPC can't buffer + redeliver. */
export async function uploadBytes(
  bytes: Uint8Array,
  ext: string,
  reqId: string,
  index: number,
): Promise<void> {
  const ackKey = `${reqId}-${index}`;
  const ack = new Promise<void>((resolve, reject) => {
    uploadAcks.set(ackKey, (error) => (error ? reject(new Error(error)) : resolve()));
  });
  figma.ui.postMessage({
    type: "upload-asset",
    reqId,
    index,
    bytes,
    ext,
  });
  await ack;
}

/** Export a node via exportAsync (rendered PNG/SVG) and ship the bytes. */
export async function exportAndUpload(
  n: any,
  format: "SVG" | "PNG",
  reqId: string,
  index: number,
): Promise<WireAsset> {
  const settings: any =
    format === "SVG"
      ? { format: "SVG" }
      : { format: "PNG", constraint: { type: "SCALE", value: 2 } };
  const bytes: Uint8Array = await n.exportAsync(settings);
  await uploadBytes(bytes, format === "SVG" ? "svg" : "png", reqId, index);
  return { id: n.id, name: n.name, format, path: null };
}

/** Ship the *original uploaded image* for a node's first IMAGE fill — bypasses
 *  exportAsync entirely. Useful when an agent needs the asset that was
 *  uploaded into Figma (e.g. a profile photo) rather than a 2× re-render. */
export async function extractRawImageAndUpload(
  n: any,
  reqId: string,
  index: number,
): Promise<WireAsset | null> {
  const hash = firstImageHash(n);
  if (!hash) return null;
  const image = figma.getImageByHash(hash);
  if (!image) return null;
  const bytes = await image.getBytesAsync();
  const format = detectImageFormat(bytes);
  const ext = format === "PNG" ? "png" : format === "JPG" ? "jpg" : format === "GIF" ? "gif" : "webp";
  await uploadBytes(bytes, ext, reqId, index);
  return { id: n.id, name: n.name, format, path: null };
}

export function pickFormatForNode(n: any): "SVG" | "PNG" {
  if (Array.isArray(n.exportSettings) && n.exportSettings.length > 0) {
    return settingsFormat(n);
  }
  if (hasImageFill(n)) return "PNG";
  // Default: SVG — Figma can export almost any node as SVG.
  return "SVG";
}

/** Surgical mode — export exactly these ids, one asset each, no recursion. */
export async function collectSpecific(
  ids: string[],
  reqId: string,
  list: boolean,
  raw: boolean,
): Promise<WireAsset[]> {
  const assets: WireAsset[] = [];
  for (const id of ids) {
    if (assets.length >= MAX_ASSETS) break;
    const node = await figma.getNodeByIdAsync(id);
    if (!node || node.type === "PAGE" || node.type === "DOCUMENT") continue;
    const n = node as any;
    if (n.visible === false) continue;
    const format = pickFormatForNode(n);
    if (list) {
      assets.push({ id: n.id, name: n.name, format, path: null });
      continue;
    }
    if (raw && hasImageFill(n)) {
      const rawAsset = await extractRawImageAndUpload(n, reqId, assets.length);
      if (rawAsset) {
        assets.push(rawAsset);
        continue;
      }
      // Fall through to a rendered export if the hash couldn't be resolved.
    }
    assets.push(await exportAndUpload(n, format, reqId, assets.length));
  }
  return assets;
}

export async function collectAssets(
  root: SceneNode,
  reqId: string,
  opts: { list?: boolean; raw?: boolean } = {},
): Promise<WireAsset[]> {
  const assets: WireAsset[] = [];

  /**
   * Always descend — even after exporting — so nested groups are collected.
   * The user's spec: "go inside groups, export, go deeper, repeat".
   * Tweak: standalone VECTOR nodes are exported only when no ancestor was
   * exported — otherwise they are already contained in that ancestor's SVG.
   * With `list: true`, we record the same candidates but skip exportAsync.
   */
  async function visit(
    n: any,
    isRoot: boolean,
    ancestorExported: boolean,
    ancestorId: string | undefined,
  ): Promise<void> {
    if (assets.length >= MAX_ASSETS || n.visible === false) return;

    let format: "SVG" | "PNG" | null = null;
    if (!isRoot) {
      const hasExport = Array.isArray(n.exportSettings) && n.exportSettings.length > 0;
      if (hasExport) {
        format = settingsFormat(n);
      } else if (isVectorGroup(n)) {
        format = "SVG";
      } else if (CONTAINER_TYPES.indexOf(n.type) !== -1 && isIconSubtree(n)) {
        format = "SVG";
      } else if (VECTOR_TYPES.indexOf(n.type) !== -1 && !ancestorExported) {
        format = "SVG";
      } else if (hasImageFill(n)) {
        format = "PNG";
      }
    }

    let nextAncestorId = ancestorId;
    let exportedHere = false;
    if (format) {
      let asset: WireAsset;
      if (opts.list) {
        asset = { id: n.id, name: n.name, format, path: null };
      } else if (opts.raw && hasImageFill(n)) {
        const rawAsset = await extractRawImageAndUpload(n, reqId, assets.length);
        asset = rawAsset ?? await exportAndUpload(n, format, reqId, assets.length);
      } else {
        asset = await exportAndUpload(n, format, reqId, assets.length);
      }
      if (ancestorId) asset.parentId = ancestorId;
      assets.push(asset);
      exportedHere = true;
      nextAncestorId = n.id;
    }

    if (Array.isArray(n.children)) {
      for (const c of n.children) {
        await visit(c, false, exportedHere || ancestorExported, nextAncestorId);
      }
    }
  }

  await visit(root, true, false, undefined);
  return assets;
}
