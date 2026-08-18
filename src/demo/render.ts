/**
 * The reference renderer — the oracle behind `npm run demo`.
 *
 * Given a PDS, produce the `RenderedElement[]` a browser *would* report if you
 * built the design exactly: every box, every computed style, every asset tag.
 * By construction, feeding this back into `verifyAgainst` must yield zero
 * deltas and a 100.0 fit score.
 *
 * Two things fall out of that:
 *
 *   1. The demo can run the entire design → code → verify loop offline, with no
 *      Figma token, no browser, and no network — see `src/demo/run.ts`.
 *   2. It is an executable statement of what the verify engine considers a
 *      correct build. A check that reads a PDS field the renderer doesn't emit
 *      would fire on a perfect build, and `demo.test.ts` fails. That makes this
 *      a regression net for the comparison engine, not just demo scaffolding.
 *
 * Styles are emitted in the shape `getComputedStyle` returns them — `"24px"`,
 * `"rgb(11, 17, 32)"`, `"400"` — not the authored shorthand, because that is
 * what a real capture hands `plumb_verify`.
 */
import { resolveFills, resolveLayout } from "../normalize/resolve";
import type { Fill, PdsDocument, PdsNode, TokenTable } from "../pds";
import { parseTextToken, type RenderedElement } from "../verify";

/** Hex (`#0b1120`, `#0b112080`) → the `rgb()`/`rgba()` form a browser reports. */
export function hexToCss(hex: string): string {
  const m = /^#?([0-9a-f]{3,8})$/i.exec(hex.trim());
  if (!m || !m[1]) return hex;
  let h = m[1];
  if (h.length === 3 || h.length === 4) h = h.split("").map((c) => c + c).join("");
  if (h.length !== 6 && h.length !== 8) return hex;
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  if (h.length === 6) return `rgb(${r}, ${g}, ${b})`;
  const a = Math.round((parseInt(h.slice(6, 8), 16) / 255) * 100) / 100;
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}

function px(n: number): string {
  // Browsers report whole pixels without a decimal tail.
  return `${Math.round(n * 100) / 100}px`;
}

/** Resolve a `$cN` ref (or a literal hex) to the CSS colour a browser reports. */
function colorOf(ref: string | undefined, tokens: TokenTable): string | undefined {
  if (!ref) return undefined;
  const hex = ref.startsWith("$c") ? tokens.color[ref] : ref;
  return hex ? hexToCss(hex) : undefined;
}

/** One CSS background layer per non-solid fill, matching `fills.count`. */
function backgroundImageOf(fills: Fill[]): string | undefined {
  const layers = fills
    .map((f) => {
      if (f.type === "image") return "url(\"about:blank\")";
      if (f.type === "color") return `linear-gradient(${hexToCss(f.color)}, ${hexToCss(f.color)})`;
      const stops = (f.stops ?? []).map((s) => `${hexToCss(s.color)} ${Math.round(s.at * 100)}%`);
      const angle = f.type === "linear-gradient" ? `${f.angle ?? 180}deg, ` : "";
      return `${f.type}(${angle}${stops.join(", ")})`;
    })
    .filter(Boolean);
  return layers.length ? layers.join(", ") : undefined;
}

/** Every `el` reachable from the document root, in stable walk order. */
export function reachableEls(pds: PdsDocument): string[] {
  const seen = new Set<string>();
  const order: string[] = [];
  const walk = (el: string): void => {
    if (seen.has(el)) return;
    seen.add(el);
    const node = pds.nodes[el];
    if (!node) return;
    order.push(el);
    for (const child of node.children ?? []) walk(child);
  };
  walk(pds.root);
  return order;
}

function stylesFor(node: PdsNode, tokens: TokenTable): Record<string, string> {
  const styles: Record<string, string> = {};

  const layout = resolveLayout(node.layout, tokens);
  if (layout) {
    styles.display = "flex";
    styles.flexDirection = layout.flow === "col" ? "column" : "row";
    if (layout.gap !== undefined) styles.gap = px(layout.gap);
    const [t, r, b, l] = layout.pad;
    styles.paddingTop = px(t);
    styles.paddingRight = px(r);
    styles.paddingBottom = px(b);
    styles.paddingLeft = px(l);
    if (layout.justify) styles.justifyContent = layout.justify;
    if (layout.align) styles.alignItems = layout.align;
  }

  // Text nodes paint their fill as `color`; everything else as a background.
  const fillCss = colorOf(node.fill, tokens);
  if (fillCss) {
    if (node.type === "text") styles.color = fillCss;
    else styles.backgroundColor = fillCss;
  }

  const fills = resolveFills(node.fills, tokens);
  if (fills && fills.length > 1) {
    const bg = backgroundImageOf(fills);
    if (bg) styles.backgroundImage = bg;
  }

  if (node.type === "text" && node.text?.startsWith("$t")) {
    const parsed = parseTextToken(tokens.text[node.text] ?? "");
    if (parsed) {
      styles.fontSize = px(parsed.size);
      styles.fontWeight = String(parsed.weight);
      if (parsed.lh) styles.lineHeight = px(parsed.lh * parsed.size);
      if (parsed.family) styles.fontFamily = parsed.family;
    }
  }
  if (node.type === "text" && node.textDecoration) {
    styles.textDecorationLine = node.textDecoration;
  }

  if (node.radius !== undefined) {
    let radius: number | null = null;
    if (typeof node.radius === "string") {
      const tok = tokens.radius[node.radius];
      // "full" is Figma's pill/circle sentinel — a browser reports the resolved
      // pixel value, which is half the shorter side.
      radius = tok === "full" ? Math.min(node.box.w, node.box.h) / 2 : (tok ?? null);
    } else if (Array.isArray(node.radius)) {
      radius = node.radius[0] ?? null;
    }
    if (radius !== null) styles.borderRadius = px(radius);
  }

  const strokeCss = colorOf(node.stroke, tokens);
  if (strokeCss) styles.borderColor = strokeCss;
  if (node.strokeW !== undefined) styles.borderWidth = px(node.strokeW);

  if (typeof node.opacity === "number") styles.opacity = String(node.opacity);

  const shadow =
    typeof node.shadow === "string" && node.shadow.startsWith("$s")
      ? tokens.shadow[node.shadow]
      : node.shadow;
  if (shadow) styles.boxShadow = shadow;
  if (node.backdropFilter) styles.backdropFilter = node.backdropFilter;

  if (typeof node.rotation === "number" && Math.abs(node.rotation) > 0.5) {
    styles.transform = `rotate(${node.rotation}deg)`;
  }
  if (typeof node.grow === "number" && node.grow > 0) styles.flexGrow = String(node.grow);
  if (node.selfAlign) {
    const map: Record<string, string> = {
      stretch: "stretch",
      min: "flex-start",
      max: "flex-end",
      center: "center",
    };
    const v = map[node.selfAlign];
    if (v) styles.alignSelf = v;
  }

  return styles;
}

/**
 * Render the PDS as the perfect build: one tagged element per reachable node,
 * every computed style matching the spec.
 */
export function renderReference(pds: PdsDocument): RenderedElement[] {
  const out: RenderedElement[] = [];
  for (const el of reachableEls(pds)) {
    const node = pds.nodes[el];
    if (!node) continue;
    const element: RenderedElement = {
      el,
      box: { x: 0, y: 0, w: node.box.w, h: node.box.h },
      styles: stylesFor(node, pds.tokens),
    };
    if (typeof node.chars === "string") element.text = node.chars;
    if (node.assetId) element.asset = node.assetId;
    // Vector/image nodes must render real image content, not a redrawn div.
    if (node.assetId || node.type === "vector" || node.type === "image" || node.vectorPath) {
      element.img = true;
    }
    out.push(element);
  }
  return out;
}
