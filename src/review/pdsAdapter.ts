/**
 * Built-PDS → `RenderedElement[]` adapter for the write-direction critique.
 *
 * The symmetry payoff (blueprint §0): after emit we re-serialize the created
 * Figma nodes back through `normalize()` into a *built* PdsDocument, then diff
 * it against the *authored* PdsDocument the DSL compiler produced. We do that
 * diff with the EXISTING `verifyAgainst` engine instead of a bespoke PDS-vs-PDS
 * comparator — so this module is the shim that turns a built PDS node into the
 * same `{ el, box, text, styles }` shape an agent's `getComputedStyle` capture
 * would produce. Resolving the built node's own token refs to concrete CSS
 * values (against the BUILT token table) makes `verifyAgainst(authored, …)`
 * fire a delta exactly where emit diverged from what we authored.
 *
 * The join across the two docs is `EmitResult.ids` (authored `el` → Figma node
 * id): `remapBuiltToAuthored` inverts it (Figma id → authored `el`) and, since
 * every built node carries its raw Figma `id`, rewrites each rendered element's
 * key to the authored `el` so verify can match them up.
 */
import { resolveLayout } from "../normalize/resolve";
import { parseTextToken } from "../verify";
import type { PdsDocument, PdsNode, TokenTable } from "../pds";
import type { RenderedElement } from "../verify";

/** Resolve a `$cN` colour ref (or a literal hex) to a hex string. */
function resolveColor(ref: string | undefined, tokens: TokenTable): string | undefined {
  if (!ref) return undefined;
  if (ref.startsWith("$c")) return tokens.color[ref];
  return ref;
}

/** Map a PDS `selfAlign` to its CSS `align-self` value (mirrors verify). */
function cssAlignSelf(selfAlign: PdsNode["selfAlign"]): string | undefined {
  switch (selfAlign) {
    case "stretch":
      return "stretch";
    case "min":
      return "flex-start";
    case "max":
      return "flex-end";
    case "center":
      return "center";
    default:
      return undefined;
  }
}

/**
 * Derive the `getComputedStyle` subset verify reads from a single built node.
 * Only keys we can resolve are set — an unset key means "verify won't compare
 * this axis", which is correct when the built node simply doesn't carry it.
 */
function stylesForNode(node: PdsNode, tokens: TokenTable): Record<string, string> {
  const styles: Record<string, string> = {};
  const isText = node.type === "text";

  // --- Fill: background for non-text, colour for text -----------------------
  const fillHex = resolveColor(node.fill, tokens);
  if (fillHex) {
    if (isText) styles.color = fillHex;
    else styles.backgroundColor = fillHex;
  }

  // --- Layout ---------------------------------------------------------------
  const layout = resolveLayout(node.layout, tokens);
  if (layout) {
    styles.flexDirection = layout.flow === "col" ? "column" : "row";
    if (layout.gap !== undefined) styles.gap = `${layout.gap}px`;
    const [t, r, b, l] = layout.pad;
    styles.paddingTop = `${t}px`;
    styles.paddingRight = `${r}px`;
    styles.paddingBottom = `${b}px`;
    styles.paddingLeft = `${l}px`;
    if (layout.justify) styles.justifyContent = layout.justify;
    if (layout.align) styles.alignItems = layout.align;
  }

  // --- Type style (weight / size / line-height / family) --------------------
  if (typeof node.text === "string" && node.text.startsWith("$t")) {
    const raw = tokens.text[node.text];
    const parsed = raw ? parseTextToken(raw) : null;
    if (parsed) {
      styles.fontSize = `${parsed.size}px`;
      styles.fontWeight = String(parsed.weight);
      // Emit line-height in px (lh-ratio × size). verify's
      // computeLineHeightRatio divides any numeric line-height by the font
      // size, so `lh*size`px round-trips back to exactly `lh` — keeping both
      // sides symmetric (zero spurious delta when built == authored).
      if (parsed.lh !== undefined) styles.lineHeight = `${parsed.lh * parsed.size}px`;
      if (parsed.family) styles.fontFamily = parsed.family;
    }
  }
  if (isText && node.textDecoration) styles.textDecorationLine = node.textDecoration;

  // --- Radius ---------------------------------------------------------------
  if (node.radius !== undefined) {
    let px: number | null = null;
    if (typeof node.radius === "string") {
      const resolved = tokens.radius[node.radius];
      // "full" → any large value; verify's "full" branch checks >= minSide/2.
      px = resolved === "full" ? 9999 : (resolved ?? null);
    } else if (Array.isArray(node.radius)) {
      px = node.radius[0] ?? null;
    }
    if (px !== null) styles.borderRadius = `${px}px`;
  }

  // --- Stroke ---------------------------------------------------------------
  const strokeHex = resolveColor(node.stroke, tokens);
  if (strokeHex) styles.borderColor = strokeHex;
  if (node.strokeW !== undefined) styles.borderWidth = `${node.strokeW}px`;

  // --- Opacity --------------------------------------------------------------
  if (typeof node.opacity === "number") styles.opacity = String(node.opacity);

  // --- Shadow ---------------------------------------------------------------
  const shadow =
    typeof node.shadow === "string" && node.shadow.startsWith("$s")
      ? tokens.shadow[node.shadow]
      : typeof node.shadow === "string"
        ? node.shadow
        : undefined;
  if (shadow) styles.boxShadow = shadow;

  // --- Backdrop filter ------------------------------------------------------
  if (node.backdropFilter) styles.backdropFilter = node.backdropFilter;

  // --- Flex-child sizing ----------------------------------------------------
  if (typeof node.grow === "number" && node.grow > 0) styles.flexGrow = String(node.grow);
  const alignSelf = cssAlignSelf(node.selfAlign);
  if (alignSelf) styles.alignSelf = alignSelf;

  // --- Fill-stack: expose layer count so verify's fills.count check agrees --
  const fills =
    typeof node.fills === "string" ? tokens.fills?.[node.fills] : node.fills;
  if (Array.isArray(fills) && fills.length > 1) {
    styles.backgroundImage = fills
      .map(() => "linear-gradient(#000, #000)")
      .join(", ");
  }

  return styles;
}

/**
 * Flatten a built PdsDocument into `RenderedElement[]`, keyed by the built `el`.
 * Assets are reported as real content (`img: true`, `asset: assetId`) because a
 * re-serialized Figma image/vector IS the real thing — this keeps verify's
 * asset-fidelity check from false-flagging emitted images as "redrawn".
 */
export function pdsToRendered(built: PdsDocument): RenderedElement[] {
  const out: RenderedElement[] = [];
  for (const el of Object.keys(built.nodes)) {
    const node = built.nodes[el];
    if (!node) continue;
    const el2: RenderedElement = {
      el,
      box: {
        x: node.pos?.x ?? 0,
        y: node.pos?.y ?? 0,
        w: node.box.w,
        h: node.box.h,
      },
      styles: stylesForNode(node, built.tokens),
    };
    if (typeof node.chars === "string") el2.text = node.chars;
    const hasAsset = typeof node.assetId === "string" && node.assetId.length > 0;
    const isVectorish =
      node.type === "vector" || node.type === "image" || node.vectorPath !== undefined;
    if (hasAsset) {
      el2.asset = node.assetId;
      el2.img = true;
    } else if (isVectorish) {
      el2.img = true;
    }
    out.push(el2);
  }
  return out;
}

/**
 * Build the built-`el` → authored-`el` remap from `EmitResult.ids`
 * (authored `el` → Figma node id). Inverts `ids` to Figma-id → authored-`el`,
 * then walks the built nodes (each carrying its raw Figma `id`) to key by the
 * built `el`. Built nodes with no authored ancestor in `ids` are omitted from
 * the map — the caller keeps their built `el`, so verify surfaces them as extra
 * `missing-in-pds` nodes (emit created something we didn't author).
 *
 * When `ids` is absent, returns an empty map: the caller then falls back to a
 * direct `el`-based join, which only lines up if authored and built share the
 * same handle namespace (they usually don't — pass `ids`).
 */
export function remapBuiltToAuthored(
  built: PdsDocument,
  ids?: Record<string, string>,
): Map<string, string> {
  const remap = new Map<string, string>();
  if (!ids) return remap;
  const figIdToAuthored = new Map<string, string>();
  for (const authoredEl of Object.keys(ids)) {
    const figId = ids[authoredEl];
    if (figId) figIdToAuthored.set(figId, authoredEl);
  }
  for (const el of Object.keys(built.nodes)) {
    const node = built.nodes[el];
    if (!node) continue;
    const authoredEl = figIdToAuthored.get(node.id);
    if (authoredEl) remap.set(el, authoredEl);
  }
  return remap;
}

/**
 * Apply a built→authored remap to a rendered list: rewrite each element's `el`
 * to the authored handle when mapped, otherwise leave it (it becomes an extra).
 */
export function applyRemap(
  rendered: RenderedElement[],
  remap: Map<string, string>,
): RenderedElement[] {
  if (remap.size === 0) return rendered;
  return rendered.map((r) => {
    const authored = remap.get(r.el);
    return authored ? { ...r, el: authored } : r;
  });
}
