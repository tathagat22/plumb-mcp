/**
 * Semantic Graph → web-import projection. Deliberately its OWN shape, not a
 * `PdsDocument` — an HTML-sourced node carries literal CSS values (a real
 * hex color, an actual px number), never a Figma-style `$cN` token ref, and
 * pretending otherwise by reusing `PdsDocument`'s shape would misrepresent
 * what this data actually is. A new source gets an honestly-shaped new
 * projection (§4's own "projections are purpose-built views" principle).
 */
import type { CirAnnotation, CirNode, CirNodeStyle, NodeKind, SemanticGraph } from "../graph";
import type { Effect, Fill, PdsLayout } from "../../pds";

export interface WebNode {
  id: string;
  kind: NodeKind;
  box: { w: number; h: number };
  pos?: { x: number; y: number };
  chars?: string;
  /** Detected semantic role — same values as PDS's `pattern` field
   *  (nav/hero/footer/sidebar; not `card`, see buildFromHtml.ts's scope
   *  note — repeat/similarity detection isn't built for HTML yet). */
  role?: string;
  /** 0..1 — same meaning as `PdsNode.patternConfidence`; see that field's
   *  docstring. */
  roleConfidence?: number;
  layout?: PdsLayout;
  textPx?: number;
  /** Primary font family — text nodes only. See `CirNodeStyle.fontFamily`'s
   *  own docstring. Feeds `WebSpecDocument.fontLinks`. */
  fontFamily?: string;
  isSurface?: boolean;
  fillColor?: string;
  /** Full fill stack — gradients, or a compact-would-be-lossy multi-layer
   *  case. Undefined for plain solid colors; use `fillColor` for those. */
  fills?: Fill[];
  effects?: Effect[];
  backdropFilter?: string;
  opacity?: number;
  textAlign?: string;
  textDecoration?: CirNodeStyle["textDecoration"];
  /** Real bug, found while wiring `svgMarkup` through this same file:
   *  `buildFromHtml.ts`'s `styleOf()` already computes this from CSS
   *  `text-transform` (Phase E, prior session) but this projection never
   *  copied it across — silently dropped before it ever reached the agent's
   *  JSON, exactly the class of parity bug `imageSrc`'s own docstring above
   *  describes. */
  textCase?: CirNodeStyle["textCase"];
  letterSpacing?: number;
  lineHeightPx?: number;
  position?: CirNodeStyle["position"];
  borderRadius?: CirNodeStyle["borderRadius"];
  borderColor?: string;
  borderWidth?: number;
  /** `kind: "image"` nodes only — see `CirNode.imageSrc`'s own docstring.
   *  Missing from this projection until M10 needed it to actually generate
   *  an `<img>` tag from an imported page, not just classify around it —
   *  a real gap, found and closed the same way the `opacity`-captured-but-
   *  dropped bug in M9.1 was: by trying to build the next real consumer. */
  imageSrc?: string;
  /** `kind: "vector"` nodes only — see `CirNode.svgMarkup`'s own docstring. */
  svgMarkup?: string;
  children?: string[];
}

export interface WebSpecDocument {
  url: string;
  root: string;
  nodes: Record<string, WebNode>;
  meta: { nodeCount: number };
  next: string;
  /** `<link>` URLs for every distinct captured `fontFamily` that matches a
   *  known Google Fonts family — set by `src/tools/importHtml.ts` after
   *  projection (font-catalog matching lives with the asset engine, not
   *  this projection layer). Without this, a generated page silently falls
   *  back to a system font even when the source page used a real webfont —
   *  the captured `fontFamily` alone isn't enough to actually LOAD it. */
  fontLinks?: string[];
}

export function projectWebSpec(url: string, graph: SemanticGraph, annotations: CirAnnotation[]): WebSpecDocument {
  const roleAnnotations = annotations.filter((a) => a.namespace === "role");
  const roleByNode = new Map(roleAnnotations.map((a) => [a.nodeId, String(a.value)]));
  const roleConfidenceByNode = new Map(
    roleAnnotations.filter((a) => typeof a.confidence === "number").map((a) => [a.nodeId, a.confidence as number]),
  );

  const nodes: Record<string, WebNode> = {};
  for (const [id, n] of Object.entries(graph.nodes)) {
    nodes[id] = {
      id: n.id,
      kind: n.kind,
      box: n.box,
      pos: n.pos,
      chars: n.chars,
      role: roleByNode.get(id),
      roleConfidence: roleConfidenceByNode.get(id),
      layout: n.style.layout,
      textPx: n.style.textPx,
      fontFamily: n.style.fontFamily,
      isSurface: n.style.isSurface,
      fillColor: n.style.fillColor,
      fills: n.style.fills,
      effects: n.style.effects,
      backdropFilter: n.style.backdropFilter,
      opacity: n.style.opacity,
      textAlign: n.style.textAlign,
      textDecoration: n.style.textDecoration,
      textCase: n.style.textCase,
      letterSpacing: n.style.letterSpacing,
      lineHeightPx: n.style.lineHeightPx,
      position: n.style.position,
      borderRadius: n.style.borderRadius,
      borderColor: n.style.borderColor,
      borderWidth: n.style.borderWidth,
      imageSrc: n.imageSrc,
      svgMarkup: n.svgMarkup,
      children: n.children.length ? n.children : undefined,
    };
  }

  return {
    url,
    root: graph.root,
    nodes,
    meta: { nodeCount: Object.keys(nodes).length },
    next:
      "Nodes with a `role` (nav/hero/footer/sidebar) were classified by the same " +
      "heuristics plumb_node uses on Figma designs. `card` isn't detected on " +
      "imported pages yet — it depends on repeat-group detection this adapter " +
      "doesn't build. Use plumb_diff to compare two imports of the same page " +
      "over time.",
  };
}

/**
 * The reverse of `projectWebSpec` — rebuilds a `SemanticGraph` (plus a
 * `role` map) from an already-produced `WebSpecDocument`, so a caller that
 * only has a prior `plumb_import_web` result (not a live URL) can still
 * feed it to a graph-consuming tool like `src/emit/react.ts` without a
 * second capture. `edges` comes back empty — nothing that's been built so
 * far needs edges reconstructed from a flattened `WebNode` map (repeat/
 * instanceOf detection isn't run on HTML-sourced graphs regardless — see
 * `buildFromHtml.ts`'s own scope note), so this stays honest rather than
 * fabricating edges nothing asked for.
 */
export function graphFromWebSpec(doc: WebSpecDocument): { graph: SemanticGraph; roleByNode: Map<string, string> } {
  const nodes: Record<string, CirNode> = {};
  const roleByNode = new Map<string, string>();

  for (const [id, n] of Object.entries(doc.nodes)) {
    if (n.role) roleByNode.set(id, n.role);
    nodes[id] = {
      id: n.id,
      kind: n.kind,
      box: n.box,
      pos: n.pos,
      children: n.children ?? [],
      chars: n.chars,
      imageSrc: n.imageSrc,
      svgMarkup: n.svgMarkup,
      style: {
        layout: n.layout,
        textPx: n.textPx,
        fontFamily: n.fontFamily,
        isSurface: n.isSurface,
        fillColor: n.fillColor,
        fills: n.fills,
        effects: n.effects,
        backdropFilter: n.backdropFilter,
        opacity: n.opacity,
        textAlign: n.textAlign,
        textDecoration: n.textDecoration,
        textCase: n.textCase,
        letterSpacing: n.letterSpacing,
        lineHeightPx: n.lineHeightPx,
        position: n.position,
        borderRadius: n.borderRadius,
        borderColor: n.borderColor,
        borderWidth: n.borderWidth,
      },
      sourceRef: { adapter: "html", nativeId: id },
    };
  }

  return { graph: { cirVersion: "1.0.0", root: doc.root, nodes, edges: [] }, roleByNode };
}
