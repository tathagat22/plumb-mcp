import { PlumbError } from "../errors";
import type { FigmaFileResult, FigmaNode } from "./types";

export interface RestRequest {
  fileKey: string;
  nodeId: string;
  depth: number;
  token: string;
}

interface RestNodesResponse {
  name?: string;
  version?: string | number;
  nodes?: Record<string, { document?: FigmaNode } | undefined>;
}

/**
 * Milestone 0 ingest: fetch a single node subtree via the Figma REST API.
 * Plan §3/§11: REST is the secondary path — fine for the M0 proof against one
 * known file, but rate-limited on free workspaces; the plugin path (M1) is
 * primary.
 */
export async function fetchNodeViaRest(req: RestRequest): Promise<FigmaFileResult> {
  const { fileKey, nodeId, depth, token } = req;
  const url =
    `https://api.figma.com/v1/files/${encodeURIComponent(fileKey)}` +
    `/nodes?ids=${encodeURIComponent(nodeId)}&depth=${depth}`;

  let res: Awaited<ReturnType<typeof fetch>>;
  try {
    res = await fetch(url, { headers: { "X-Figma-Token": token } });
  } catch (e) {
    throw new PlumbError(
      `Could not reach api.figma.com: ${(e as Error).message}`,
      "Check your internet connection, then retry.",
    );
  }

  if (!res.ok) throw restError(res.status, fileKey);

  const json = (await res.json()) as RestNodesResponse;
  const entry = json.nodes?.[nodeId];
  if (!entry?.document) {
    throw new PlumbError(
      `Figma returned no node "${nodeId}" for file "${fileKey}".`,
      "Check the node id — copy the part after 'node-id=' in the Figma URL and " +
        "replace '-' with ':'. Confirm it belongs to this file.",
    );
  }

  return {
    document: entry.document,
    fileName: json.name ?? "",
    version: String(json.version ?? ""),
  };
}

function restError(status: number, fileKey: string): PlumbError {
  switch (status) {
    case 401:
    case 403:
      return new PlumbError(
        `Figma rejected the request (HTTP ${status}).`,
        "Set a valid token in the FIGMA_TOKEN env var. Create a read-only token " +
          "at figma.com → Settings → Security → personal access tokens.",
      );
    case 404:
      return new PlumbError(
        `Figma file "${fileKey}" was not found (HTTP 404).`,
        "Check the file key — it is the string after '/design/' or '/file/' in the Figma URL.",
      );
    case 429:
      return new PlumbError(
        "Figma rate-limited the request (HTTP 429).",
        "Wait, then retry. REST limits are very low on free/Starter workspaces — " +
          "this is exactly why Plumb's primary path is the plugin, not REST.",
      );
    default:
      return new PlumbError(
        `Figma REST request failed (HTTP ${status}).`,
        "Retry; if it persists, check status.figma.com.",
      );
  }
}
