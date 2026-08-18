/**
 * Asset fidelity.
 *
 * A structural diff cannot see that a logo is the WRONG picture, but it can
 * see the two cases that quietly inflate a score: the exported asset was never
 * used (redrawn as a styled div) or a different asset id was swapped in. Only
 * fires on elements the agent actually tagged.
 */

import type { CheckContext } from "./context";

export function checkAssets(c: CheckContext): void {
    // --- Asset fidelity (real-world: a logo/icon/image must be the actual
    //     exported asset or vector — NOT a redrawn box). Structural checks can't
    //     see that a logo is the *wrong picture*, but they can catch the cases
    //     that quietly inflate the score: the asset wasn't used at all (redrawn
    //     as a styled div) or a different asset id was swapped in. Only fires on
    //     elements the agent actually tagged. ---
    const isRaster = typeof c.node.assetId === "string" && c.node.assetId.length > 0;
    const isVectorAsset =
      c.node.type === "vector" || c.node.type === "image" || c.node.vectorPath !== undefined;
    if (isRaster || isVectorAsset) {
      const rAsset = c.r.asset;
      if (isRaster && rAsset && rAsset !== c.node.assetId) {
        c.push("asset.mismatch", c.node.assetId ?? null, rAsset, "error");
      } else if (isRaster && rAsset === c.node.assetId) {
        // exact exported asset used — perfect, no delta.
      } else if (!c.r.img) {
        // a visual node rendered with no real image/vector content → redrawn or omitted.
        c.push("asset.missing", isRaster ? (c.node.assetId ?? "exported asset") : "image/vector content", "(none — redrawn or omitted)", "error");
      } else if (isRaster && !rAsset) {
        // rendered an image but didn't tag which — can't confirm it's the export.
        c.push("asset.untagged", c.node.assetId ?? null, "(image present, data-plumb-asset missing)", "warn");
      }
    }
}
