/**
 * Shared "Figma target → PDS" resolution for the verify-family tools
 * (`plumb_verify`, `plumb_fit`). Both need the exact same plumb path: resolve
 * a screen by id / name / URL, prefer the paired plugin when no fileKey is
 * given, fall back to the REST path otherwise, and normalize to a budgeted
 * PDS. Keeping it in one place means the two tools can never drift.
 */
import { formatScreenMatches, resolveScreen } from "../bridge/inventory";
import { requestNode } from "../bridge/server";
import { bridge } from "../bridge/store";
import { PlumbError } from "../errors";
import { fetchNodeViaRest } from "../figma/rest";
import { resolveFigmaTarget } from "../figma/url";
import { normalizeToBudget } from "../normalize/budget";
import { requireToken } from "./shared";
import type { FigmaFileResult } from "../figma/types";
import type { PdsDocument } from "../pds";

export interface TargetArgs {
  id?: string;
  name?: string;
  fileKey?: string;
  url?: string;
}

export type VerifyTarget =
  | { kind: "ambiguous"; matches: ReturnType<typeof formatScreenMatches> }
  | {
      kind: "pds";
      source: "plugin" | "rest";
      screen: string | null;
      pds: PdsDocument;
    };

/**
 * Resolve a Figma target to a PDS, or report an ambiguous screen name so the
 * caller can ask the agent to disambiguate. Never returns partial state.
 */
export async function resolveVerifyTarget(
  args: TargetArgs,
  depth: number,
): Promise<VerifyTarget> {
  const { fileKey, id } = resolveFigmaTarget({
    url: args.url,
    fileKey: args.fileKey,
    id: args.id,
  });
  const source: "plugin" | "rest" = bridge.paired && !fileKey ? "plugin" : "rest";

  if (source === "plugin") {
    const resolved = resolveScreen(id, args.name);
    if ("ambiguous" in resolved) {
      return { kind: "ambiguous", matches: formatScreenMatches(resolved.ambiguous) };
    }
    const { doc, nodeName } = await requestNode(resolved.id);
    if (!doc) {
      throw new PlumbError(
        `The Plumb plugin could not find node "${resolved.id}".`,
        "Call plumb_outline for the current screen list — it may have been deleted or renamed.",
      );
    }
    const file: FigmaFileResult = {
      document: doc,
      fileName: bridge.inventory?.fileName ?? "",
      version: `plugin-${Date.now()}`,
    };
    const pds = normalizeToBudget(file, depth, undefined, { notes: false });
    return { kind: "pds", source, screen: nodeName, pds };
  }

  if (!fileKey || !id) {
    throw new PlumbError(
      "Plumb needs the plugin paired (id/name), or a fileKey + id (or a Figma url) for the REST path.",
      "Pair the Plumb plugin in Figma, paste a Figma URL via `url`, or pass both fileKey and id.",
    );
  }
  const token = requireToken();
  const file = await fetchNodeViaRest({ fileKey, nodeId: id, depth: depth + 1, token });
  const pds = normalizeToBudget(file, depth, undefined, { notes: false });
  return { kind: "pds", source, screen: file.document.name, pds };
}
