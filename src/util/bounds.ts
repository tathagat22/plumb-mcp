/**
 * Cheap iterative (not recursive) guards against pathological caller-supplied
 * JSON — deeply nested or huge objects that would otherwise blow the call
 * stack or exhaust CPU/memory in a recursive validator (zod's `z.lazy`
 * schemas) or a recursive consumer, before that code ever gets to run.
 * Intentionally generous limits — this is a backstop against adversarial/
 * accidental pathological input, not a normal-usage ceiling.
 */

const DEFAULT_MAX_DEPTH = 80;
const DEFAULT_MAX_NODES = 20_000;

export interface StructureBounds {
  maxDepth?: number;
  maxNodes?: number;
}

export interface BoundsViolation {
  kind: "depth" | "nodes";
  limit: number;
  actual: number;
}

/** Returns a violation if `value`'s object/array nesting depth or total
 *  node count exceeds the given bounds, else `null`. Iterative — safe to
 *  run on untrusted input before any recursive code (zod parsing, a
 *  recursive walker) touches it. */
export function checkStructureBounds(value: unknown, bounds: StructureBounds = {}): BoundsViolation | null {
  const maxDepth = bounds.maxDepth ?? DEFAULT_MAX_DEPTH;
  const maxNodes = bounds.maxNodes ?? DEFAULT_MAX_NODES;
  let nodeCount = 0;
  const stack: { v: unknown; depth: number }[] = [{ v: value, depth: 0 }];
  while (stack.length > 0) {
    const { v, depth } = stack.pop()!;
    if (v === null || typeof v !== "object") continue;
    nodeCount++;
    if (nodeCount > maxNodes) return { kind: "nodes", limit: maxNodes, actual: nodeCount };
    if (depth > maxDepth) return { kind: "depth", limit: maxDepth, actual: depth };
    const children = Array.isArray(v) ? v : Object.values(v as Record<string, unknown>);
    for (const child of children) stack.push({ v: child, depth: depth + 1 });
  }
  return null;
}

/** Throws a plain `Error` (callers wrap as a `PlumbError` with tool-specific
 *  guidance) if `value` fails {@link checkStructureBounds}. */
export function assertStructureBounds(value: unknown, bounds?: StructureBounds): void {
  const violation = checkStructureBounds(value, bounds);
  if (!violation) return;
  if (violation.kind === "depth") {
    throw new Error(`Nesting depth ${violation.actual} exceeds the maximum of ${violation.limit}.`);
  }
  throw new Error(`Contains ${violation.actual} object/array nodes, over the maximum of ${violation.limit}.`);
}
