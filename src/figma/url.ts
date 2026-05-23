/**
 * Parse a Figma URL into the pieces our tools want.
 *
 * Accepted shapes:
 *   https://www.figma.com/design/<fileKey>/<filename>?node-id=<nodeId>
 *   https://www.figma.com/file/<fileKey>/<filename>?node-id=<nodeId>
 *   https://www.figma.com/design/<fileKey>/branch/<branchKey>/<filename>?node-id=<nodeId>
 *   https://www.figma.com/proto/<fileKey>/<filename>?node-id=<nodeId>
 *   www.figma.com/...  (no protocol — we add one)
 *
 * Figma's URL node-id uses `-` as the separator (e.g. `10-2`), while the
 * Plugin / REST APIs use `:` (e.g. `10:2`). We normalise to colons.
 */

export interface ParsedFigmaUrl {
  fileKey: string;
  nodeId?: string;
  branchKey?: string;
}

const PATH_RE = /^\/(?:design|file|proto)\/([^/]+)(?:\/branch\/([^/]+))?/;

/** Returns null if `input` doesn't look like a Figma URL we recognise. */
export function parseFigmaUrl(input: string): ParsedFigmaUrl | null {
  if (typeof input !== "string" || input.length === 0) return null;
  const text = input.trim();
  if (text.length === 0) return null;

  // Allow callers to paste either a full URL or just the host-relative path,
  // so this works equally well for `figma.com/design/...` and the full thing.
  const withProtocol = /^https?:\/\//.test(text) ? text : `https://${text}`;

  let url: URL;
  try {
    url = new URL(withProtocol);
  } catch {
    return null;
  }
  if (!url.hostname.endsWith("figma.com")) return null;

  const m = PATH_RE.exec(url.pathname);
  if (!m) return null;

  const fileKey = m[1];
  if (!fileKey) return null;

  const branchKey = m[2];
  const rawNodeId = url.searchParams.get("node-id");
  const nodeId = rawNodeId ? rawNodeId.replace(/-/g, ":") : undefined;

  const out: ParsedFigmaUrl = { fileKey };
  if (nodeId) out.nodeId = nodeId;
  if (branchKey) out.branchKey = branchKey;
  return out;
}

/**
 * Merge an optional Figma URL into explicit fileKey/id arguments — the URL
 * fills the gaps but explicit args win on conflict. Most tools accept all
 * three (url, fileKey, id) and pass through this normaliser.
 */
export function resolveFigmaTarget(args: {
  url?: string;
  fileKey?: string;
  id?: string;
}): { fileKey?: string; id?: string; branchKey?: string } {
  if (!args.url) {
    return { fileKey: args.fileKey, id: args.id };
  }
  const parsed = parseFigmaUrl(args.url);
  if (!parsed) {
    // Caller can decide whether to error — we surface the explicit args as-is.
    return { fileKey: args.fileKey, id: args.id };
  }
  return {
    fileKey: args.fileKey ?? parsed.fileKey,
    id: args.id ?? parsed.nodeId,
    branchKey: parsed.branchKey,
  };
}
