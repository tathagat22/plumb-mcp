/**
 * Repeating-list compression.
 *
 * A 40-row table costs 40× the tokens of one row and teaches an agent nothing
 * new after the third. This collapses runs of structurally identical siblings
 * to one template plus a per-instance delta map: the compressed siblings stay
 * in `parent.children` so the renderer walks them in order, but their entries
 * are (deliberately) absent from `nodes` and hydrate from `repeat.data`.
 */

import type { PdsNode } from "../pds";

/* ---------------------------------------------------------------------- */
/* Repeating-list compression                                               */
/* ---------------------------------------------------------------------- */

/** Minimum consecutive identical-fingerprint siblings to compress. */
export const REPEAT_MIN = 3;

/**
 * Structural fingerprint for a PDS subtree. Two nodes have the same
 * fingerprint iff their shape, styling, and layout are identical — modulo
 * the fields that legitimately vary between list items (`chars`, `assetId`,
 * `id`, `el`, `name`, `path`, `pos`).
 */
function fingerprintSubtree(el: string, nodes: Record<string, PdsNode>): string {
  const n = nodes[el];
  if (!n) return "";
  // Walk children first, then build a canonical JSON representation. Sorted
  // keys keep the output stable across Node versions / object insertion order.
  const childPrints = (n.children ?? []).map((c) => fingerprintSubtree(c, nodes));
  // Strip varying fields. Image fills: scrub the per-instance assetId so two
  // rows with different photos still match. A ref string is already a stable
  // identity (image-fill stacks aren't interned, so refs only appear for
  // solid/gradient stacks where the assetId scrub is a no-op).
  const fillsForPrint =
    typeof n.fills === "string"
      ? n.fills
      : (n.fills ?? []).map((f) =>
          f.type === "image" ? { ...f, assetId: undefined } : f,
        );
  const skeleton: Record<string, unknown> = {
    type: n.type,
    box: n.box,
    layout: n.layout,
    fill: n.fill,
    fills: fillsForPrint.length > 0 ? fillsForPrint : undefined,
    inheritedFill: n.inheritedFill,
    stroke: n.stroke,
    strokeW: n.strokeW,
    strokeAlign: n.strokeAlign,
    strokeSides: n.strokeSides,
    strokeDash: n.strokeDash,
    radius: n.radius,
    radiusVar: n.radiusVar,
    shadow: n.shadow,
    effects: n.effects,
    backdropFilter: n.backdropFilter,
    opacity: n.opacity,
    clip: n.clip,
    text: n.text,
    textDecoration: n.textDecoration,
    textCase: n.textCase,
    component: n.component,
    pattern: n.pattern,
    // iconHint + notes are DERIVED from per-instance data (sibling chars,
    // etc.) so they legitimately vary across otherwise-identical rows.
    // Excluded here; iconHint surfaces as an override below.
    isMask: n.isMask,
    maskMode: n.maskMode,
    masked: n.masked,
    boolOp: n.boolOp,
    grow: n.grow,
    selfAlign: n.selfAlign,
    sizing: n.sizing,
    vectorPath: n.vectorPath,
    childPrints,
  };
  return JSON.stringify(canonicalize(skeleton));
}

/** Recursively drop undefined fields and sort keys for a stable JSON form. */
function canonicalize(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(canonicalize);
  if (v && typeof v === "object") {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(v as Record<string, unknown>).sort()) {
      const val = (v as Record<string, unknown>)[k];
      if (val === undefined) continue;
      out[k] = canonicalize(val);
    }
    return out;
  }
  return v;
}

/**
 * Walk two same-shape subtrees in lockstep and collect the per-leaf
 * differences (`chars`, `assetId`) keyed by the TEMPLATE's el — so the
 * agent renders the template once and applies these overrides per row.
 */
function extractOverrides(
  templateEl: string,
  instanceEl: string,
  nodes: Record<string, PdsNode>,
): Record<
  string,
  { chars?: string | import("../pds").PdsTextRun[]; assetId?: string; iconHint?: string }
> {
  const out: Record<
    string,
    { chars?: string | import("../pds").PdsTextRun[]; assetId?: string; iconHint?: string }
  > = {};
  function walkPair(tEl: string, iEl: string): void {
    const t = nodes[tEl];
    const i = nodes[iEl];
    if (!t || !i) return;
    const delta: {
      chars?: string | import("../pds").PdsTextRun[];
      assetId?: string;
      iconHint?: string;
    } = {};
    if (t.chars !== i.chars && i.chars !== undefined) delta.chars = i.chars;
    if (t.assetId !== i.assetId && i.assetId !== undefined) delta.assetId = i.assetId;
    if (t.iconHint !== i.iconHint && i.iconHint !== undefined) delta.iconHint = i.iconHint;
    if (
      delta.chars !== undefined ||
      delta.assetId !== undefined ||
      delta.iconHint !== undefined
    ) {
      out[tEl] = delta;
    }
    const tKids = t.children ?? [];
    const iKids = i.children ?? [];
    const n = Math.min(tKids.length, iKids.length);
    for (let k = 0; k < n; k++) walkPair(tKids[k]!, iKids[k]!);
  }
  walkPair(templateEl, instanceEl);
  return out;
}

/** Recursively delete a node and its descendants from the nodes map. */
function deleteSubtree(el: string, nodes: Record<string, PdsNode>): void {
  const n = nodes[el];
  if (!n) return;
  for (const c of n.children ?? []) deleteSubtree(c, nodes);
  delete nodes[el];
}

/**
 * After the parent's children have been walked, detect consecutive runs of
 * identical-fingerprint siblings (≥ REPEAT_MIN) and collapse each run into
 * a template + per-instance override map. v0.10 Phase 4 — finds ALL runs in
 * the parent's children, not just the first; a screen like "Header + 6 rows
 * + Spacer + 4 cards" compresses both clusters. Mutates `nodes` in place
 * (removes compressed siblings).
 */
export function compressRepeats(parent: PdsNode, nodes: Record<string, PdsNode>): void {
  const kids = parent.children;
  if (!kids || kids.length < REPEAT_MIN) return;
  const prints = kids.map((k) => fingerprintSubtree(k, nodes));

  const groups: import("../pds").PdsRepeatGroup[] = [];
  let i = 0;
  while (i < prints.length) {
    // Walk forward as long as the print matches the run's anchor.
    if (!prints[i] || prints[i]!.length === 0) {
      i++;
      continue;
    }
    let j = i + 1;
    while (j < prints.length && prints[j] === prints[i]) j++;
    const runLen = j - i;
    if (runLen >= REPEAT_MIN) {
      const templateEl = kids[i]!;
      const data: Record<
        string,
        Record<
          string,
          { chars?: string | import("../pds").PdsTextRun[]; assetId?: string; iconHint?: string }
        >
      > = {};
      for (let k = i + 1; k < j; k++) {
        const instanceEl = kids[k]!;
        data[instanceEl] = extractOverrides(templateEl, instanceEl, nodes);
        deleteSubtree(instanceEl, nodes);
      }
      groups.push({ template: templateEl, data });
    }
    i = j;
  }
  if (groups.length === 0) return;
  // Keep v0.9-shaped output (single object) for the common one-run case so
  // existing agents see no change; switch to the array shape only when the
  // parent actually contains multiple runs.
  parent.repeat = groups.length === 1 ? groups[0] : groups;
}
