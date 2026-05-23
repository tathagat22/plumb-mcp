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
  fill: "background — token ref $cN into tokens.color, or 'gradient' / 'image'",
  stroke: "border colour — token ref $cN into tokens.color",
  strokeW: "border width in px",
  radius:
    "border-radius — token ref $rN into tokens.radius (value is px or \"full\" for pill/circle), or per-corner [tl,tr,br,bl]",
  shadow: "CSS box-shadow string",
  text: "type style — token ref $tN into tokens.text ('weight size/lh family')",
  chars: "literal text content of a TEXT node",
  opacity: "0..1, omitted when 1",
  clip: "overflow is clipped",
  component: "mainComponent id (INSTANCE nodes)",
  children: "child `el` handles included in this response",
  more: "this many children were NOT included — call plumb_node on `id` to expand",
};
