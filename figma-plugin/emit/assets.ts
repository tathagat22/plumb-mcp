/// <reference types="@figma/plugin-typings" />

/**
 * Asset hydration — the plan's asset refs into the `imageHash` / SVG-text
 * tables the node builders consume.
 */

import type { EmitAsset, EmitWarning, ProgressFn } from "./wire";
import { errText } from "./shared";

/* ------------------------------------------------------------------ */
/* Assets → imageHash / svg text                                       */
/* ------------------------------------------------------------------ */

export interface AssetTables {
  /** ref → Figma image hash (raster). */
  images: Map<string, string>;
  /** ref → raw SVG text (vector). */
  svgs: Map<string, string>;
}

export function decodeUtf8(bytes: Uint8Array): string {
  if (typeof TextDecoder !== "undefined") return new TextDecoder("utf-8").decode(bytes);
  let s = "";
  for (let i = 0; i < bytes.length; i += 1) s += String.fromCharCode(bytes[i]);
  return decodeURIComponent(escape(s));
}

/**
 * Turn hydrated asset bytes into things the scene graph can reference:
 * raster bytes → `figma.createImage` hash; SVG (inline or bytes) → text kept
 * for `figma.createNodeFromSvg` at node-creation time.
 */
export function hydrateAssets(
  assets: EmitAsset[] | undefined,
  warnings: EmitWarning[],
  onProgress?: ProgressFn,
): AssetTables {
  const images = new Map<string, string>();
  const svgs = new Map<string, string>();
  const list = assets ?? [];
  const total = list.length;
  let done = 0;
  for (const a of list) {
    try {
      if (a.kind === "svg") {
        const text = a.svgInline ?? (a.data ? decodeUtf8(a.data) : "");
        if (text) svgs.set(a.ref, text);
        else warnings.push({ key: a.ref, field: "asset", message: "svg asset had no data" });
      } else {
        if (a.data && a.data.length) {
          const img = figma.createImage(a.data);
          images.set(a.ref, img.hash);
        } else {
          warnings.push({ key: a.ref, field: "asset", message: "image asset had no bytes" });
        }
      }
    } catch (e) {
      warnings.push({ key: a.ref, field: "asset", message: errText(e) });
    }
    done += 1;
    onProgress?.("assets", done, total);
  }
  return { images, svgs };
}
