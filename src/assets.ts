import {
  mkdirSync,
  renameSync,
  statSync,
  copyFileSync,
  unlinkSync,
  readFileSync,
} from "node:fs";
import { join } from "node:path";
import type { WireAsset } from "./bridge/protocol";

export interface WrittenAsset {
  id: string;
  name: string;
  format: string;
  path: string;
  bytes: number;
  /** The id of the nearest ancestor that was also exported. */
  parentId?: string;
  /**
   * Inline source — SVG markup as a string, or a `data:` URI for small
   * bitmaps. Present only when `inline:true` was requested on the export and
   * the asset is within the size cap. Use this to drop icons straight into
   * components without re-reading the file from disk.
   */
  source?: string;
}

/** Bitmaps above this many bytes are not base64-inlined (kept on disk only). */
export const INLINE_MAX_BYTES = 64 * 1024;

const MIME_FOR_FORMAT: Record<string, string> = {
  SVG: "image/svg+xml",
  PNG: "image/png",
  JPG: "image/jpeg",
  GIF: "image/gif",
  WEBP: "image/webp",
};

/**
 * Build the inline `source` string for a freshly written asset. SVGs come back
 * as raw markup (always — they're text and tiny); bitmaps come back as
 * `data:image/<fmt>;base64,…` only when under INLINE_MAX_BYTES so we don't
 * blow up the agent's context with a megabyte of base64.
 */
function buildInlineSource(format: string, path: string, bytes: number): string | undefined {
  if (format === "SVG") {
    try {
      return readFileSync(path, "utf8");
    } catch {
      return undefined;
    }
  }
  if (bytes > INLINE_MAX_BYTES) return undefined;
  const mime = MIME_FOR_FORMAT[format];
  if (!mime) return undefined;
  try {
    const buf = readFileSync(path);
    return `data:${mime};base64,${buf.toString("base64")}`;
  } catch {
    return undefined;
  }
}

function extForFormat(format: string): string {
  switch (format) {
    case "SVG": return "svg";
    case "JPG": return "jpg";
    case "GIF": return "gif";
    case "WEBP": return "webp";
    default: return "png";
  }
}

function slug(s: string): string {
  return (
    s
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48) || ""
  );
}

/**
 * Move the bridge's temp-file uploads into a per-screen folder under
 * ./plumb-assets (overridable via PLUMB_ASSETS_DIR). Asset bytes never appear
 * in this process — they ride the binary HTTP upload channel and land on disk
 * before we get here, so this is just a rename (or copy across filesystems).
 */
export function writeAssets(
  screenName: string,
  assets: WireAsset[],
  opts: { inline?: boolean } = {},
): { dir: string; written: WrittenAsset[] } {
  const root = process.env.PLUMB_ASSETS_DIR ?? join(process.cwd(), "plumb-assets");
  const dir = join(root, slug(screenName) || "screen");
  mkdirSync(dir, { recursive: true });

  const used = new Set<string>();
  const written: WrittenAsset[] = [];
  for (const asset of assets) {
    if (!asset.path) continue; // list mode or upload failed — skip silently
    const ext = extForFormat(asset.format);
    const base = slug(asset.name) || "asset";
    let file = `${base}.${ext}`;
    let n = 2;
    while (used.has(file)) file = `${base}-${n++}.${ext}`;
    used.add(file);

    const fullPath = join(dir, file);
    try {
      renameSync(asset.path, fullPath);
    } catch {
      // tmpdir on a different filesystem from cwd — fall back to copy+unlink.
      copyFileSync(asset.path, fullPath);
      try { unlinkSync(asset.path); } catch { /* best-effort */ }
    }
    const bytes = statSync(fullPath).size;
    const out: WrittenAsset = {
      id: asset.id,
      name: asset.name,
      format: asset.format,
      path: fullPath,
      bytes,
      parentId: asset.parentId,
    };
    if (opts.inline) {
      const source = buildInlineSource(asset.format, fullPath, bytes);
      if (source !== undefined) out.source = source;
    }
    written.push(out);
  }
  return { dir, written };
}
