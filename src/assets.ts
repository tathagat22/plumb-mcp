import { mkdirSync, writeFileSync } from "node:fs";
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
 * Decode the bridge's base64 assets and write them to a per-screen folder
 * under ./plumb-assets (overridable via PLUMB_ASSETS_DIR). Returns file paths —
 * never base64 — so the response stays token-frugal (plan §6).
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
    const ext = asset.format === "SVG" ? "svg" : "png";
    const base = slug(asset.name) || "asset";
    let file = `${base}.${ext}`;
    let n = 2;
    while (used.has(file)) file = `${base}-${n++}.${ext}`;
    used.add(file);

    const buffer = Buffer.from(asset.dataBase64, "base64");
    const fullPath = join(dir, file);
    writeFileSync(fullPath, buffer);
    written.push({
      id: asset.id,
      name: asset.name,
      format: asset.format,
      path: fullPath,
      bytes: buffer.length,
      parentId: asset.parentId,
    });
  }
  return { dir, written };
}
