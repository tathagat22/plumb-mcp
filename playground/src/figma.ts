/**
 * Browser-side Figma extraction. Reuses the exact REST fetch + normalize
 * pipeline the server uses, plus a render thumbnail from the Images API for
 * the side-by-side. Runs with the visitor's own Figma token.
 *
 * Note: Figma's REST API may reject cross-origin browser calls (CORS) depending
 * on their current policy. The bundled demo designs need no Figma call and
 * always work; this path is best-effort, and the caller surfaces a friendly
 * "use a demo design or the local CLI" message if Figma blocks the request.
 */
import { fetchNodeViaRest } from "../../src/figma/rest";
import { resolveFigmaTarget } from "../../src/figma/url";
import { normalizeToBudget } from "../../src/normalize/budget";
import type { PdsDocument } from "../../src/pds";

export interface ExtractResult {
  pds: PdsDocument;
  imageUrl: string | null;
  name: string;
}

export async function extractFromFigmaUrl(
  url: string,
  token: string,
  depth = 12,
): Promise<ExtractResult> {
  const { fileKey, id } = resolveFigmaTarget({ url });
  if (!fileKey || !id) {
    throw new Error("Couldn't read a file key + node id from that URL. Copy the link from Figma's share menu with a frame selected.");
  }
  const file = await fetchNodeViaRest({ fileKey, nodeId: id, depth: depth + 1, token });
  const pds = normalizeToBudget(file, depth, undefined, { notes: false });
  const imageUrl = await fetchRenderUrl(fileKey, id, token).catch(() => null);
  return { pds, imageUrl, name: file.document.name ?? id };
}

async function fetchRenderUrl(fileKey: string, nodeId: string, token: string): Promise<string | null> {
  const u = `https://api.figma.com/v1/images/${fileKey}?ids=${encodeURIComponent(nodeId)}&format=png&scale=2`;
  const res = await fetch(u, { headers: { "X-Figma-Token": token } });
  if (!res.ok) return null;
  const body = (await res.json()) as { images?: Record<string, string> };
  return body.images?.[nodeId] ?? null;
}
