import { PlumbError, toErrorPayload } from "../errors";
import type { PdsDocument } from "../pds";

/** Standard success envelope for an MCP tool — the payload as JSON text. */
export function ok(payload: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(payload) }] };
}

/** Standard failure envelope — instruction-shaped `{error, nextAction}` (plan §6.6). */
export function fail(e: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(toErrorPayload(e)) }],
    isError: true,
  };
}

/** The Figma token from env, or a PlumbError telling the agent how to set one. */
export function requireToken(): string {
  const token = process.env.FIGMA_TOKEN ?? process.env.FIGMA_ACCESS_TOKEN;
  if (!token) {
    throw new PlumbError(
      "No Figma token configured.",
      "Set FIGMA_TOKEN in the MCP server's env block. Create a read-only token " +
        "at figma.com → Settings → Security → personal access tokens.",
    );
  }
  return token;
}

/** Minimal shape check for a raw JSON object the caller claims is a
 *  PdsDocument (from a prior plumb_node/outline/query call) — used by
 *  tools that accept a PDS snapshot directly (plumb_diff, plumb_audit)
 *  rather than resolving a Figma target themselves. */
export function asPdsDocument(value: unknown, label: string): PdsDocument {
  if (
    typeof value !== "object" ||
    value === null ||
    typeof (value as Record<string, unknown>).root !== "string" ||
    typeof (value as Record<string, unknown>).nodes !== "object"
  ) {
    throw new PlumbError(
      `\`${label}\` doesn't look like a PdsDocument (missing \`root\`/\`nodes\`).`,
      "Pass the raw JSON object returned by a prior plumb_node / plumb_outline / plumb_query call, unmodified.",
    );
  }
  return value as PdsDocument;
}
