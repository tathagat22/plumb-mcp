/**
 * Icon-swap hints.
 *
 * A vector node called "Vector 12" tells an agent nothing. This infers what an
 * icon probably *is* — from its own name, a nearby text sibling, or the
 * pattern its siblings follow — so the build can reach for the right icon
 * instead of tracing a path. Conservative by design: a wrong hint is worse
 * than none, because the agent will act on it.
 */

import type { FigmaNode } from "../figma/types";
import type { PdsLayout, PdsNode } from "../pds";

/* ---------------------------------------------------------------------- */
/* Icon-swap hints                                                          */
/* ---------------------------------------------------------------------- */

/** Names Figma auto-generates that carry no semantic information. */
const GENERIC_NAME =
  /^(image|vector|rectangle|rect|ellipse|circle|line|frame|group|instance|node|layer|shape|path|union|subtract|intersect|exclude|component)\s*\d*$/i;

const ICON_MAX_SIZE = 64;

/** Strip the trailing "Button" / "Icon" / "IconButton" noise from a name. */
function cleanIconLabel(s: string): string {
  return s
    .replace(/([a-z])([A-Z])/g, "$1 $2") // SearchButton → "Search Button"
    .replace(/[_-]+/g, " ")
    .replace(/\b(icon|button|btn|iconbutton|cta)\b/gi, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

export function isDescriptive(name: string): boolean {
  if (!name) return false;
  const cleaned = cleanIconLabel(name);
  if (!cleaned) return false;
  if (GENERIC_NAME.test(cleaned)) return false;
  return cleaned.length >= 2;
}

function hasImageFill(fn: FigmaNode): boolean {
  if (!Array.isArray(fn.fills)) return false;
  return fn.fills.some((p) => p?.visible !== false && p?.type === "IMAGE");
}

function isIconShaped(node: PdsNode, fn: FigmaNode): boolean {
  if (node.box.w > ICON_MAX_SIZE || node.box.h > ICON_MAX_SIZE) return false;
  if (node.box.w === 0 || node.box.h === 0) return false;
  const aspect = node.box.w / node.box.h;
  if (aspect < 0.5 || aspect > 2) return false;
  if (hasImageFill(fn)) return true;
  if (fn.type === "VECTOR" || fn.type === "BOOLEAN_OPERATION") return true;
  const name = (node.name ?? "").toLowerCase();
  if (name.includes("icon")) return true;
  return false;
}

/** First TEXT sibling under `parent` with non-empty characters, skipping the
 *  subtree rooted at `excludeId` (the icon node we're labelling). */
function findTextSibling(
  parent: FigmaNode | undefined,
  excludeId: string,
): string | undefined {
  if (!parent?.children) return undefined;
  for (const sib of parent.children) {
    if (sib.id === excludeId) continue;
    if (sib.visible === false) continue;
    if (sib.type === "TEXT" && typeof sib.characters === "string") {
      const chars = sib.characters.trim();
      if (chars) return chars;
    }
  }
  return undefined;
}

/** Find an icon's labelling TEXT — first try direct siblings, then climb one
 *  level to grandparent's direct children (skipping the parent's own subtree).
 *  Catches the common pattern where a button is `[wrapper > vector] + TEXT`:
 *  the vector's direct sibling is empty, but the wrapper's sibling is the
 *  label. Climb is capped at 1 ancestor to avoid pulling labels from
 *  unrelated regions of the tree. */
function siblingLabel(
  fn: FigmaNode,
  parent: FigmaNode | undefined,
  grandparent?: FigmaNode,
): string | undefined {
  const direct = findTextSibling(parent, fn.id);
  if (direct) return direct;
  if (grandparent && parent) {
    return findTextSibling(grandparent, parent.id);
  }
  return undefined;
}

/**
 * Build the icon hint by reading the design context instead of the pixels.
 * Order of preference: own descriptive name → sibling TEXT label → parent's
 * descriptive name. Returns undefined when the node isn't icon-shaped or
 * when no signal is available — the agent gracefully falls back to the
 * file path / inline source.
 */
/**
 * Tag row-layout clusters that look like a button — text + (stroke OR fill) +
 * radius, sized within human-button bounds. Saves the renderer from inferring
 * "this is a button" from geometry every time. Conservative: only emits when
 * all signals align, so missing-button is preferred over false-positive.
 */
export function inferPattern(
  fn: FigmaNode,
  node: PdsNode,
  layout: PdsLayout | undefined,
): string | undefined {
  // Use the literal layout (not the possibly-interned ref on node.layout).
  if (!layout || layout.flow !== "row") return undefined;
  const { w, h } = node.box;
  if (w < 40 || w > 480 || h < 20 || h > 80) return undefined;
  const hasVisual = Boolean(node.stroke || node.fill || node.fills);
  if (!hasVisual) return undefined;
  if (node.radius === undefined) return undefined;
  const labeled = (fn.children ?? []).some(
    (c) =>
      c.visible !== false &&
      c.type === "TEXT" &&
      typeof c.characters === "string" &&
      c.characters.trim().length > 0,
  );
  if (!labeled) return undefined;
  return "button";
}

export function inferIconHint(
  fn: FigmaNode,
  parent: FigmaNode | undefined,
  grandparent: FigmaNode | undefined,
  ancestors: FigmaNode[],
  node: PdsNode,
): string | undefined {
  if (!isIconShaped(node, fn)) return undefined;
  if (isDescriptive(node.name ?? "")) {
    const own = cleanIconLabel(node.name ?? "");
    if (own) return own;
  }
  const label = siblingLabel(fn, parent, grandparent);
  if (label) return label;
  // Climb the ancestor chain, skipping generic names ("Group", "Frame 12",
  // "Vector") rather than stopping at the first non-descriptive container.
  // A real-world icon often lives 3–4 levels deep under generic wrappers
  // while the semantic name sits on a higher container ("Notifications",
  // "Settings"). Capped at 4 to avoid promoting an icon to a screen-level
  // label like "App / Workspace / Home".
  for (const anc of ancestors) {
    if (!isDescriptive(anc.name ?? "")) continue;
    const ancLabel = cleanIconLabel(anc.name ?? "");
    if (ancLabel) return ancLabel;
  }
  return undefined;
}
