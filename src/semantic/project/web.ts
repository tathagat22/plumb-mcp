/**
 * Semantic Graph → web-import projection. Deliberately its OWN shape, not a
 * `PdsDocument` — an HTML-sourced node carries literal CSS values (a real
 * hex color, an actual px number), never a Figma-style `$cN` token ref, and
 * pretending otherwise by reusing `PdsDocument`'s shape would misrepresent
 * what this data actually is. A new source gets an honestly-shaped new
 * projection (§4's own "projections are purpose-built views" principle).
 */
import type { CirAnnotation, CirNodeStyle, NodeKind, SemanticGraph } from "../graph";
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
  layout?: PdsLayout;
  textPx?: number;
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
  letterSpacing?: number;
  lineHeightPx?: number;
  position?: CirNodeStyle["position"];
  children?: string[];
}

export interface WebSpecDocument {
  url: string;
  root: string;
  nodes: Record<string, WebNode>;
  meta: { nodeCount: number };
  next: string;
}

export function projectWebSpec(url: string, graph: SemanticGraph, annotations: CirAnnotation[]): WebSpecDocument {
  const roleByNode = new Map(
    annotations.filter((a) => a.namespace === "role").map((a) => [a.nodeId, String(a.value)]),
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
      layout: n.style.layout,
      textPx: n.style.textPx,
      isSurface: n.style.isSurface,
      fillColor: n.style.fillColor,
      fills: n.style.fills,
      effects: n.style.effects,
      backdropFilter: n.style.backdropFilter,
      opacity: n.style.opacity,
      textAlign: n.style.textAlign,
      textDecoration: n.style.textDecoration,
      letterSpacing: n.style.letterSpacing,
      lineHeightPx: n.style.lineHeightPx,
      position: n.style.position,
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
