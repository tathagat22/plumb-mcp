import { mkdirSync, renameSync, statSync, copyFileSync, unlinkSync } from "node:fs";
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
): { dir: string; written: WrittenAsset[] } {
  const root = process.env.PLUMB_ASSETS_DIR ?? join(process.cwd(), "plumb-assets");
  const dir = join(root, slug(screenName) || "screen");
  mkdirSync(dir, { recursive: true });

  const used = new Set<string>();
  const written: WrittenAsset[] = [];
  for (const asset of assets) {
    if (!asset.path) continue; // list mode or upload failed — skip silently
    const ext = asset.format === "SVG" ? "svg" : "png";
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
    written.push({
      id: asset.id,
      name: asset.name,
      format: asset.format,
      path: fullPath,
      bytes: statSync(fullPath).size,
      parentId: asset.parentId,
    });
  }
  return { dir, written };
}
