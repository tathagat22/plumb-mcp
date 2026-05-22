import { PlumbError, toErrorPayload } from "../errors";

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
