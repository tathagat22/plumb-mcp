/**
 * Semantic Graph → React/JSX. The CIR analog of `src/emit/plan.ts` (the
 * mechanical, deterministic PDS→Figma lowering) — same "every conversion
 * happens here, the consumer just assigns" philosophy, different target.
 * Deliberately NOT the LLM-based approach `src/fit/generate.ts` already
 * uses for HTML: that's a documented, caller-funded escape hatch for cases
 * a deterministic transform can't handle; this is the deterministic
 * default docs/ROADMAP-v0.14-design-intelligence.md §2's own law #4
 * requires ("determinism is the default, LLM-assisted reasoning is an
 * opt-in the caller pays for").
 *
 * Works on a `SemanticGraph` from EITHER adapter — `buildSemanticGraph`
 * (Figma) or `buildSemanticGraphFromHtml` (HTML) — with zero branching on
 * `sourceRef.adapter`, which is the second concrete proof (after
 * `RoleEnricher` running unmodified on an HTML-sourced graph) that the CIR
 * actually is adapter-agnostic, not just designed to look that way.
 *
 * Every box's `width`/`height` is emitted as an explicit pixel value by
 * default (a faithful snapshot) UNLESS the node carries Figma's own
 * hug/fill/fixed sizing intent (`CirNodeStyle.sizing`/`.grow`/`.selfAlign`,
 * mirroring `PdsNode`'s own fields) AND its parent is a flex container —
 * then the matching axis gets `flexGrow`/`alignSelf`/an omitted pixel size
 * instead, so a `sizing.w: "fill"` node reflows instead of clipping its
 * parent's own resize. Figma-sourced graphs carry this signal (`build.ts`);
 * the HTML adapter does not yet (buildFromHtml.ts has no CSS-inference pass
 * for it) — those nodes fall back to the pixel-faithful default, honestly,
 * not approximated.
 */
import type { CirNode, SemanticGraph } from "../semantic/graph";
import type { Effect, Fill } from "../pds";

export interface ReactEmitOptions {
  /** Default `"GeneratedComponent"`. */
  componentName?: string;
  /** From `RoleEnricher`'s annotations — used to pick a semantic tag
   *  (`nav`/`footer`/`aside`/`section`) instead of a bare `div`. Optional:
   *  omit for a graph nothing has enriched yet. */
  roleByNode?: Map<string, string>;
}

export interface ReactEmitResult {
  code: string;
  /** One entry per node the walk couldn't render faithfully — a missing
   *  child (a dangling repeat-compressed reference, see `walk`'s own
   *  comment) or a `vector` kind with no reproducible content. Never
   *  thrown; codegen degrades node-by-node, matching every other
   *  enricher/comparator's own failure-mode contract in this codebase. */
  warnings: string[];
}

const ROLE_TAG: Record<string, string> = {
  nav: "nav",
  footer: "footer",
  sidebar: "aside",
};

const TEXT_TRANSFORM_CSS: Record<"UPPER" | "LOWER" | "TITLE", string> = {
  UPPER: "uppercase",
  LOWER: "lowercase",
  TITLE: "capitalize",
};

function tagFor(node: CirNode, role: string | undefined): string {
  if (role && ROLE_TAG[role]) return ROLE_TAG[role];
  if (node.kind === "text") return "p";
  if (node.kind === "image") return "img";
  return "div";
}

function px(n: number): string {
  return String(Math.round(n * 100) / 100);
}

function effectsToBoxShadow(effects: Effect[]): string | undefined {
  const shadows = effects.filter((e): e is Extract<Effect, { type: "drop-shadow" | "inner-shadow" }> =>
    e.type === "drop-shadow" || e.type === "inner-shadow",
  );
  if (!shadows.length) return undefined;
  return shadows
    .map((e) => `${e.type === "inner-shadow" ? "inset " : ""}${px(e.x)}px ${px(e.y)}px ${px(e.blur)}px ${px(e.spread)}px ${e.color}`)
    .join(", ");
}

/** Linear gradients only — the only kind `parseGradient` (M9.1) produces;
 *  a radial/angular/diamond `Fill` reaching here (e.g. from a future
 *  adapter) is skipped, not guessed at. */
function fillsToBackgroundImage(fills: Fill[]): string | undefined {
  const gradient = fills.find((f) => f.type === "linear-gradient");
  if (!gradient || gradient.type !== "linear-gradient") return undefined;
  const stops = gradient.stops.map((s) => `${s.color} ${Math.round(s.at * 1000) / 10}%`).join(", ");
  return `linear-gradient(${gradient.angle ?? 180}deg, ${stops})`;
}

/** CSS `align-self` for PDS's `selfAlign` vocabulary. `"min"`/`"max"` are
 *  PDS's flex-start/flex-end-relative terms (matching the plugin's own
 *  authoring vocabulary), not literal CSS keywords. */
const SELF_ALIGN_CSS: Record<"stretch" | "min" | "center" | "max", string> = {
  stretch: "stretch",
  min: "flex-start",
  center: "center",
  max: "flex-end",
};

/** Builds the React inline-style object for one node — a plain JS object
 *  literal source string, not a CSS string; camelCase keys throughout.
 *  `lineHeight` is deliberately always a `"<n>px"` STRING, never a bare
 *  number — React treats a bare number there as a UNITLESS multiplier
 *  (`lineHeight: 24` means 24× the font size, not 24px), which would
 *  silently balloon every line height by ~1000x. Every other px property
 *  here is safe as a bare number; `opacity` is a 0..1 ratio, not a length,
 *  and must never get `px` appended (React already knows this — passing a
 *  number is correct as-is). */
function styleEntriesFor(
  node: CirNode,
  isRoot: boolean,
  parentFlow: "row" | "col" | "grid" | undefined,
): [string, string][] {
  const entries: [string, string][] = [];
  const s = node.style;
  const parentHasLayout = parentFlow !== undefined;

  // Responsive sizing (flexGrow/alignSelf) is a flexbox concept — grid
  // items stretch to their cell by default and don't use flex-grow at all,
  // so a grid parent skips this block entirely and its children stay
  // pixel-faithful, same as a node with no layout parent. `mainIsWidth` is
  // the flex parent's main axis: width under a row parent, height under a
  // column parent.
  let emitWidth = true;
  let emitHeight = true;
  if (!isRoot && (parentFlow === "row" || parentFlow === "col")) {
    const mainIsWidth = parentFlow === "row";
    const mainSizing = mainIsWidth ? s.sizing?.w : s.sizing?.h;
    const crossSizing = mainIsWidth ? s.sizing?.h : s.sizing?.w;

    if (s.grow || mainSizing === "fill") {
      entries.push(["flexGrow", px(s.grow ?? 1)]);
      if (mainIsWidth) emitWidth = false;
      else emitHeight = false;
    } else if (mainSizing === "hug") {
      if (mainIsWidth) emitWidth = false;
      else emitHeight = false;
    }

    if (s.selfAlign || crossSizing === "fill") {
      entries.push(["alignSelf", JSON.stringify(SELF_ALIGN_CSS[s.selfAlign ?? "stretch"])]);
      if (mainIsWidth) emitHeight = false;
      else emitWidth = false;
    }
  }
  if (emitWidth) entries.push(["width", `${px(node.box.w)}`]);
  if (emitHeight) entries.push(["height", `${px(node.box.h)}`]);

  if (!isRoot && s.position !== undefined) {
    entries.push(["position", JSON.stringify(s.position)]);
    if (node.pos) entries.push(["left", px(node.pos.x)], ["top", px(node.pos.y)]);
  } else if (!isRoot && node.pos && !parentHasLayout) {
    // Whether THE PARENT applies flex/auto-layout decides this — NOT
    // whether this node itself happens to also be a flex container for its
    // OWN children (a real bug caught by a test before this shipped: a
    // node's own `s.layout` was checked here instead of the parent's,
    // which meant a flex CHILD that also happened to lay out ITS children
    // as flex got wrongly position:absolute'd too). Mirrors PDS's own "pos
    // is emitted when the parent has no auto-layout" contract exactly.
    entries.push(["position", '"absolute"'], ["left", px(node.pos.x)], ["top", px(node.pos.y)]);
  } else if (isRoot) {
    entries.push(["position", '"relative"']);
  }

  if (s.layout?.flow === "grid") {
    // Web adapter only — Figma has no native Grid concept. `columns`/`rows`
    // are already the browser's resolved px track sizes (see PdsLayout.
    // columns's own docstring), so they paste straight in.
    entries.push(["display", '"grid"']);
    if (s.layout.columns) entries.push(["gridTemplateColumns", JSON.stringify(s.layout.columns)]);
    if (s.layout.rows) entries.push(["gridTemplateRows", JSON.stringify(s.layout.rows)]);
    if (s.layout.gap) entries.push(["columnGap", px(s.layout.gap)]);
    if (s.layout.gapCross) entries.push(["rowGap", px(s.layout.gapCross)]);
    const [t, r, b, l] = s.layout.pad;
    if (t || r || b || l) entries.push(["padding", JSON.stringify(`${px(t)}px ${px(r)}px ${px(b)}px ${px(l)}px`)]);
  } else if (s.layout) {
    entries.push(["display", '"flex"'], ["flexDirection", JSON.stringify(s.layout.flow === "col" ? "column" : "row")]);
    const [t, r, b, l] = s.layout.pad;
    if (t || r || b || l) entries.push(["padding", JSON.stringify(`${px(t)}px ${px(r)}px ${px(b)}px ${px(l)}px`)]);
    if (s.layout.gap) entries.push(["gap", px(s.layout.gap)]);
    if (s.layout.justify) entries.push(["justifyContent", JSON.stringify(s.layout.justify)]);
    if (s.layout.align) entries.push(["alignItems", JSON.stringify(s.layout.align)]);
    if (s.layout.wrap) entries.push(["flexWrap", '"wrap"']);
  }

  if (s.fills?.length) {
    const backgroundImage = fillsToBackgroundImage(s.fills);
    if (backgroundImage) entries.push(["backgroundImage", JSON.stringify(backgroundImage)]);
  } else if (s.fillColor && node.kind !== "text") {
    entries.push(["backgroundColor", JSON.stringify(s.fillColor)]);
  }
  if (node.kind === "text" && s.fillColor) entries.push(["color", JSON.stringify(s.fillColor)]);

  if (s.borderRadius !== undefined) {
    entries.push(["borderRadius", s.borderRadius === "full" ? '"9999px"' : px(s.borderRadius)]);
  }
  if (s.borderWidth) {
    entries.push(
      ["borderWidth", px(s.borderWidth)],
      ["borderStyle", '"solid"'],
      ["borderColor", JSON.stringify(s.borderColor ?? "transparent")],
    );
  }

  if (s.effects?.length) {
    const boxShadow = effectsToBoxShadow(s.effects);
    if (boxShadow) entries.push(["boxShadow", JSON.stringify(boxShadow)]);
  }
  if (s.backdropFilter) entries.push(["backdropFilter", JSON.stringify(s.backdropFilter)]);
  if (s.opacity !== undefined) entries.push(["opacity", px(s.opacity)]);

  if (node.kind === "text") {
    if (s.textPx) entries.push(["fontSize", px(s.textPx)]);
    if (s.fontFamily) entries.push(["fontFamily", JSON.stringify(s.fontFamily)]);
    if (s.textAlign) entries.push(["textAlign", JSON.stringify(s.textAlign)]);
    if (s.textDecoration) entries.push(["textDecoration", JSON.stringify(s.textDecoration)]);
    if (s.textCase) entries.push(["textTransform", JSON.stringify(TEXT_TRANSFORM_CSS[s.textCase])]);
    if (s.letterSpacing) entries.push(["letterSpacing", px(s.letterSpacing)]);
    if (s.lineHeightPx) entries.push(["lineHeight", JSON.stringify(`${px(s.lineHeightPx)}px`)]);
  }

  if (node.kind === "image") entries.push(["objectFit", '"cover"']);

  return entries;
}

function styleAttr(node: CirNode, isRoot: boolean, parentFlow: "row" | "col" | "grid" | undefined): string {
  const entries = styleEntriesFor(node, isRoot, parentFlow);
  if (!entries.length) return "";
  return ` style={{ ${entries.map(([k, v]) => `${k}: ${v}`).join(", ")} }}`;
}

function indent(depth: number): string {
  return "  ".repeat(depth);
}

function renderNode(
  id: string,
  graph: SemanticGraph,
  roleByNode: Map<string, string>,
  warnings: string[],
  depth: number,
  isRoot: boolean,
  parentFlow: "row" | "col" | "grid" | undefined,
): string {
  const node = graph.nodes[id];
  if (!node) {
    warnings.push(`Node "${id}" is referenced by a parent but missing from the graph — skipped.`);
    return "";
  }

  const role = roleByNode.get(id);
  const tag = tagFor(node, role);
  const style = styleAttr(node, isRoot, parentFlow);
  const comment = role ? ` {/* ${role} */}` : "";

  if (node.kind === "image") {
    if (!node.imageSrc) warnings.push(`Node "${id}" is an image with no captured src — src left as a placeholder.`);
    const src = JSON.stringify(node.imageSrc ?? "");
    return `${indent(depth)}<img src={${src}} alt=""${style} />${comment}`;
  }

  if (node.kind === "text") {
    const text = JSON.stringify(node.chars ?? "");
    return `${indent(depth)}<${tag}${style}>{${text}}</${tag}>${comment}`;
  }

  if (node.kind === "vector") {
    if (node.vectorPath) {
      // Figma source — a bare `d` path string; `d` never contains quotes or
      // characters that need escaping, but every other dynamic value in
      // this file goes through JSON.stringify for a JS-expression
      // attribute, so this stays consistent rather than being the one
      // literal-string exception.
      return (
        `${indent(depth)}<svg viewBox={\`0 0 ${px(node.box.w)} ${px(node.box.h)}\`}${style}>` +
        `<path d={${JSON.stringify(node.vectorPath)}} /></svg>${comment}`
      );
    }
    if (node.svgMarkup) {
      // HTML source — already-serialized real markup. dangerouslySetInnerHTML
      // rather than a JSX-attribute transform: real-world SVGs use `class`,
      // kebab-case attrs, and namespaced attributes that don't map cleanly
      // to JSX, and correctness matters more than stylistic purity for a
      // generated-code output the agent will read, not hand-author.
      return (
        `${indent(depth)}<div${style} dangerouslySetInnerHTML={{ __html: ${JSON.stringify(node.svgMarkup)} }} />${comment}`
      );
    }
    warnings.push(`Node "${id}" is a vector (icon/illustration) — no vector path is reproduced, rendered as an empty box.`);
    return `${indent(depth)}<${tag}${style} />${comment}`;
  }

  const childIds = node.children;
  if (!childIds.length) return `${indent(depth)}<${tag}${style} />${comment}`;

  const children = childIds
    .map((childId) => renderNode(childId, graph, roleByNode, warnings, depth + 1, false, node.style.layout?.flow))
    .filter(Boolean)
    .join("\n");
  if (!children) return `${indent(depth)}<${tag}${style} />${comment}`;

  return `${indent(depth)}<${tag}${style}>${comment}\n${children}\n${indent(depth)}</${tag}>`;
}

export function lowerToReact(graph: SemanticGraph, opts: ReactEmitOptions = {}): ReactEmitResult {
  const componentName = opts.componentName ?? "GeneratedComponent";
  const roleByNode = opts.roleByNode ?? new Map();
  const warnings: string[] = [];

  const body = renderNode(graph.root, graph, roleByNode, warnings, 2, true, undefined);
  const code = `export default function ${componentName}() {\n  return (\n${body}\n  );\n}\n`;

  return { code, warnings };
}
