import type { Effect, Fill, PdsLayout, TokenTable } from "../pds";

/**
 * Resolve a v0.10 compound-token field: when the value is a `$xN` ref string
 * look it up in the matching token namespace; otherwise pass through.
 *
 * The PDS schema for `layout`, `fills`, `effects`, `vectorPath`, and `props`
 * is `T | string` — Plumb may emit the literal value OR a ref into
 * `tokens.{layout|fills|effects|vector|props}`. Every consumer that reads
 * structured properties off these fields has to go through one of the
 * resolvers below, or it will see strings where it expects objects.
 *
 * Implementation is parameterised on the namespace so the resolvers stay a
 * one-liner each. Unknown refs (`$x999` with no table entry) return
 * undefined — defensive, but in practice they shouldn't appear.
 */

export function resolveLayout(
  value: PdsLayout | string | undefined,
  tokens: TokenTable,
): PdsLayout | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string") return value;
  return tokens.layout?.[value];
}

export function resolveFills(
  value: Fill[] | string | undefined,
  tokens: TokenTable,
): Fill[] | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string") return value;
  return tokens.fills?.[value];
}

export function resolveEffects(
  value: Effect[] | string | undefined,
  tokens: TokenTable,
): Effect[] | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string") return value;
  return tokens.effects?.[value];
}

export function resolveVector(
  value: string | undefined,
  tokens: TokenTable,
): string | undefined {
  if (value === undefined) return undefined;
  // Vector refs start with `$v`; raw SVG path data always starts with a
  // path command (M/m/L/l/C/c/...) — never with `$`.
  if (value.startsWith("$v")) return tokens.vector?.[value];
  return value;
}

export function resolveProps(
  value: Record<string, string | boolean | number> | string | undefined,
  tokens: TokenTable,
): Record<string, string | boolean | number> | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string") return value;
  return tokens.props?.[value];
}
