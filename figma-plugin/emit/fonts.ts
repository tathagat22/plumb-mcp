/// <reference types="@figma/plugin-typings" />

/**
 * Font loading.
 *
 * Every face in `plan.fonts` is loaded BEFORE any text node is created, and
 * `characters` is only set once `fontName` names a loaded face — Figma throws
 * otherwise. An unloadable face degrades to a fallback plus a warning rather
 * than failing the apply.
 */

import type { EmitWarning, FontFace, ProgressFn } from "./wire";
import { FALLBACK_FONTS, faceKey } from "./shared";

/* ------------------------------------------------------------------ */
/* Fonts                                                               */
/* ------------------------------------------------------------------ */

/**
 * Load every font the plan references up-front. Returns a resolver that maps a
 * requested face to the loaded face to actually use — an unloadable font is
 * remapped to the first fallback that DID load, so `setCharacters` never throws.
 */
export async function loadFonts(
  faces: FontFace[],
  warnings: EmitWarning[],
  onProgress?: ProgressFn,
): Promise<(f: FontFace) => FontFace> {
  const loaded = new Set<string>();

  async function tryLoad(f: FontFace): Promise<boolean> {
    const k = faceKey(f);
    if (loaded.has(k)) return true;
    try {
      await figma.loadFontAsync({ family: f.family, style: f.style });
      loaded.add(k);
      return true;
    } catch {
      return false;
    }
  }

  // Establish at least one working fallback face first.
  let fallback: FontFace | null = null;
  for (const fb of FALLBACK_FONTS) {
    if (await tryLoad(fb)) {
      fallback = fb;
      break;
    }
  }

  const requested = faces && faces.length ? faces : [];
  const total = requested.length;
  const remap = new Map<string, FontFace>();
  let done = 0;
  for (const f of requested) {
    const ok = await tryLoad(f);
    if (!ok) {
      const use = fallback ?? f;
      remap.set(faceKey(f), use);
      warnings.push({
        key: "@font",
        field: "font",
        message: `font "${f.family} ${f.style}" unavailable → fell back to "${use.family} ${use.style}"`,
      });
    }
    done += 1;
    onProgress?.("variables", done, total, "fonts");
  }

  return (f: FontFace): FontFace => {
    const direct = remap.get(faceKey(f));
    if (direct) return direct;
    if (loaded.has(faceKey(f))) return f;
    // A face that appeared only inside a text run and wasn't in plan.fonts.
    return fallback ?? f;
  };
}

/** Ensure an ad-hoc face (e.g. from a text run not in plan.fonts) is loaded. */
export async function ensureFace(
  f: FontFace,
  resolve: (f: FontFace) => FontFace,
  warnings: EmitWarning[],
): Promise<FontFace> {
  try {
    await figma.loadFontAsync({ family: f.family, style: f.style });
    return f;
  } catch {
    const use = resolve(f);
    warnings.push({
      key: "@font",
      field: "run.font",
      message: `run font "${f.family} ${f.style}" unavailable → "${use.family} ${use.style}"`,
    });
    return use;
  }
}
