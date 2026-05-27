/**
 * The compact-key legend (plan §6.3). Plumb's PDS uses terse keys to save
 * tokens; `plumb_status` returns this legend in-band so any agent can read a
 * PDS response correctly with zero external documentation.
 */
export const KEY_LEGEND: Record<string, string> = {
  el: 'stable node handle — tag rendered DOM with data-plumb-id="<el>"',
  id: "raw Figma node id — pass to plumb_node to drill into this node",
  box: "{ w, h } size in CSS px",
  pos: "{ x, y } position relative to parent (omitted when parent has auto-layout)",
  "layout.flow": "flex-direction — 'row' or 'col'",
  "layout.gap": "flex gap in px (Figma itemSpacing)",
  "layout.pad": "padding [top, right, bottom, left] in px",
  "layout.justify": "justify-content (omitted when flex-start)",
  "layout.align": "align-items (omitted when flex-start)",
  "layout.wrap": "flex-wrap is on",
  layout:
    "auto-layout config object — OR a $lN ref into tokens.layout when the same layout repeats across siblings (resolve via the table; same dedup pattern as $cN colors)",
  fill: "background — token ref $cN into tokens.color, or 'gradient' / 'image'",
  stroke: "border colour — token ref $cN into tokens.color",
  strokeW: "border width in px",
  radius:
    "border-radius — token ref $rN into tokens.radius (value is px or \"full\" for pill/circle), or per-corner [tl,tr,br,bl]",
  shadow: "compact CSS box-shadow string for a single shadow (dominant case)",
  effects:
    "structured stack of drop/inner shadows, layer-blur, background-blur — read this on glass / multi-shadow surfaces instead of `shadow`. May arrive as a $eN ref into tokens.effects when the same elevation stack repeats across surfaces.",
  backdropFilter:
    "CSS backdrop-filter shorthand (e.g. 'blur(24px)') when the node has a Figma background-blur",
  fills:
    "structured fill stack — solid / linear-gradient / radial-gradient / image with assetId. Emitted whenever the compact `fill` string would be lossy (multi-fill, gradient, image). Render in CSS as comma-separated layers. May arrive as a $fN ref into tokens.fills for repeating gradient/solid stacks (image stacks stay inline).",
  text: "type style — token ref $tN into tokens.text ('weight size/lh family')",
  textDecoration: "'underline' or 'line-through' on TEXT nodes (Figma STRIKETHROUGH/UNDERLINE)",
  chars: "literal text content of a TEXT node",
  opacity: "0..1, omitted when 1",
  clip: "overflow is clipped",
  component: "mainComponent id (INSTANCE nodes)",
  assetId: "Figma asset id when this node renders an image — tag DOM with data-plumb-asset for verify",
  path: "globally-unique dotted ancestor path; tag deeply-nested DOM with data-plumb-id=\"<path>\" when bare `el` would collide",
  motion: "Figma prototype reactions on this node — list of { trigger, kind, duration, easing, target }",
  iconHint:
    "inferred icon meaning for small image/vector nodes — derived from sibling TEXT labels and ancestor names. Use it to swap bitmap icons for your codebase's line-icon library without reading pixels.",
  children: "child `el` handles included in this response",
  more: "this many children were NOT included — call plumb_node on `id` to expand",
  vectorPath:
    "inline SVG path `d` string for small icons — OR a $vN ref into tokens.vector when the same icon shape repeats (raw `d` strings never start with $, so the prefix is unambiguous)",
  props:
    "component instance property overrides — OR a $pN ref into tokens.props when the same prop set repeats across instances",
  "tokens.layout / tokens.effects / tokens.fills / tokens.vector / tokens.props":
    "v0.10 compound token tables — repeated structured values (layouts, effect stacks, fill stacks, vector paths, instance prop maps) emitted once and referenced by $-id from the node tree. Resolve $xN refs by looking up the matching table.",
  "tokens.meta.counts":
    "per-ref hit counts (≥2 only) — concrete evidence of dedup, useful for sizing 'tokens before vs after' on a real screen",
};
