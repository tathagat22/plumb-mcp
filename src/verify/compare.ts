/**
 * `compareOne` — everything the engine knows how to notice about one node.
 *
 * The checks live in `checks/`, one module per concern, and this file is the
 * list of them. That list IS the documentation: read it top to bottom and you
 * know the full surface Plumb grades, which is exactly what you want in front
 * of you when adding the next check.
 *
 * They share a `CheckContext` rather than six parameters each, because they
 * genuinely share state — the same node, the same computed styles, the same
 * tolerance config, the same delta list. See `checks/context.ts`.
 *
 * Order is presentation, not logic: no check depends on another having run, so
 * the sequence only decides which findings a truncated report shows first —
 * geometry and colour before flex-child and asset detail.
 */
import type { PdsNode, TokenTable } from "../pds";
import type { Delta, RenderedElement, Tolerances } from "./types";
import { makeCheckContext, type CheckContext } from "./checks/context";
import { checkGeometry } from "./checks/geometry";
import { checkFill } from "./checks/fill";
import { checkText } from "./checks/text";
import { checkRadius } from "./checks/radius";
import { checkStroke } from "./checks/stroke";
import { checkElevation } from "./checks/shadow";
import { checkFlex } from "./checks/motion";
import { checkFillStack } from "./checks/fills";
import { checkAssets } from "./checks/assets";

/** Per-run context shared across every {@link compareOne} call. */
export interface CompareContext {
  /** Trimmed `chars` strings the design repeats ≥3× — treated as template filler. */
  dupChars: Set<string>;
}

/**
 * Every check, in report order. Adding one here is the whole wiring step —
 * and `src/demo/faults.ts` is where you prove it catches what it claims to.
 */
const CHECKS: ((c: CheckContext) => void)[] = [
  checkGeometry, // size, and auto-layout flow/gap/padding/alignment
  checkFill, // background colour, and the user-agent fallthrough
  checkText, // content, colour, decoration, and the type token
  checkRadius, // corner radius, including the pill sentinel
  checkStroke, // border colour and width, layer opacity
  checkElevation, // box-shadow and backdrop-filter
  checkFlex, // rotation, grow, align-self
  checkFillStack, // layered-fill depth
  checkAssets, // was the real exported asset used, or a redrawn box
];

export function compareOne(
  node: PdsNode,
  r: RenderedElement,
  tokens: TokenTable,
  tol: Tolerances,
  deltas: Delta[],
  ctx: CompareContext,
): void {
  const c = makeCheckContext(node, r, tokens, tol, deltas, ctx.dupChars);
  for (const check of CHECKS) check(c);
}
