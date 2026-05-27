/**
 * Text-only visual description of a PDS subtree. Built for agents that cannot
 * read the screenshot (image-blind harnesses, security policies that block
 * Read on images, or simply token-conscious callers). Everything here is
 * derived deterministically from PDS data — no rendering, no inference.
 */
import { resolveEffects, resolveFills, resolveLayout } from "./normalize/resolve";
import type { PdsDocument, PdsNode, TokenTable } from "./pds";

export type Region =
  | "top-left"
  | "top"
  | "top-right"
  | "left"
  | "center"
  | "right"
  | "bottom-left"
  | "bottom"
  | "bottom-right";

export interface NodeSummary {
  el: string;
  id: string;
  /** Mirrors PdsNode.name — undefined when Figma's name was auto-generated. */
  name?: string;
  type: string;
  box: { w: number; h: number };
  pos?: { x: number; y: number };
  region?: Region;
  appearance: string;
  chars?: string;
}

export interface DescribeResult {
  root: string;
  box: { w: number; h: number };
  layout: "auto" | "free";
  narrative: string;
  regions?: Partial<Record<Region, string[]>>;
  children: NodeSummary[];
}

/**
 * Classify a child's centre into a 3×3 grid relative to the parent's box.
 * Auto-layout parents return undefined — visual order on the major axis is
 * already implicit in the children array.
 */
function regionOf(
  parent: { w: number; h: number },
  pos: { x: number; y: number },
  box: { w: number; h: number },
): Region {
  const cx = pos.x + box.w / 2;
  const cy = pos.y + box.h / 2;
  const xb = (zone: number): "left" | "middle" | "right" =>
    zone < parent.w / 3 ? "left" : zone > (parent.w * 2) / 3 ? "right" : "middle";
  const yb = (zone: number): "top" | "middle" | "bottom" =>
    zone < parent.h / 3 ? "top" : zone > (parent.h * 2) / 3 ? "bottom" : "middle";
  const x = xb(cx);
  const y = yb(cy);
  if (y === "top" && x === "left") return "top-left";
  if (y === "top" && x === "right") return "top-right";
  if (y === "top") return "top";
  if (y === "bottom" && x === "left") return "bottom-left";
  if (y === "bottom" && x === "right") return "bottom-right";
  if (y === "bottom") return "bottom";
  if (x === "left") return "left";
  if (x === "right") return "right";
  return "center";
}

function resolveFill(node: PdsNode, tokens: TokenTable): string | undefined {
  const f = node.fill;
  if (!f) return undefined;
  if (f === "gradient" || f === "image") return f;
  if (f.startsWith("$c")) return tokens.color[f];
  return f;
}

function resolveRadius(node: PdsNode, tokens: TokenTable): string | undefined {
  const r = node.radius;
  if (r === undefined) return undefined;
  if (Array.isArray(r)) return `[${r.join(",")}]`;
  if (typeof r === "string" && r.startsWith("$r")) {
    const v = tokens.radius[r];
    if (v === undefined) return undefined;
    return v === "full" ? "full" : `${v}px`;
  }
  return String(r);
}

function summarizeFills(node: PdsNode, tokens: TokenTable): string | undefined {
  const fills = resolveFills(node.fills, tokens);
  if (fills && fills.length) {
    const parts = fills.map((f) => {
      if (f.type === "color") return f.color;
      if (f.type === "image") return f.assetId ? `image:${f.assetId}` : "image";
      const stops = f.stops.map((s) => s.color).join("→");
      const angle = "angle" in f && f.angle !== undefined ? `${f.angle}° ` : "";
      return `${f.type}(${angle}${stops})`;
    });
    return parts.length === 1 ? parts[0] : `[${parts.join(" over ")}]`;
  }
  const fill = resolveFill(node, tokens);
  return fill;
}

function summarizeAppearance(node: PdsNode, tokens: TokenTable): string {
  const parts: string[] = [];
  const fillSummary = summarizeFills(node, tokens);
  if (fillSummary) parts.push(`fill ${fillSummary}`);
  if (node.stroke && node.strokeW) {
    const stroke = node.stroke.startsWith("$c") ? tokens.color[node.stroke] : node.stroke;
    parts.push(`${node.strokeW}px ${stroke ?? "solid"} border`);
  }
  const radius = resolveRadius(node, tokens);
  if (radius) parts.push(`radius ${radius}`);
  // Effects stack: surface glass/blur explicitly so image-blind agents don't
  // write a flat fill where the design is layered.
  const effects = resolveEffects(node.effects, tokens);
  if (effects && effects.length) {
    const efParts = effects.map((e) => {
      if (e.type === "background-blur") return `frosted glass (backdrop-blur ${e.radius}px)`;
      if (e.type === "layer-blur") return `blur ${e.radius}px`;
      if (e.type === "inner-shadow") return `inset highlight ${e.color}`;
      if (e.type === "drop-shadow") return `shadow ${e.color}`;
      return "effect";
    });
    parts.push(efParts.join(", "));
  } else if (node.shadow) {
    if (node.shadow.startsWith("$s")) parts.push(`shadow ${tokens.shadow[node.shadow] ?? "yes"}`);
    else parts.push("shadow");
  }
  if (node.backdropFilter) parts.push(`backdrop ${node.backdropFilter}`);
  if (node.textDecoration) parts.push(node.textDecoration);
  if (node.opacity !== undefined && node.opacity < 1) parts.push(`opacity ${node.opacity}`);
  if (node.clip) parts.push("clipped");
  const layout = resolveLayout(node.layout, tokens);
  if (layout) {
    const dir = layout.flow === "col" ? "column" : "row";
    const gap = layout.gap ? `, gap ${layout.gap}` : "";
    parts.push(`${dir} stack${gap}`);
  }
  if (node.motion && node.motion.length) {
    parts.push(`motion (${node.motion.map((m) => m.trigger).join(", ")})`);
  }
  return parts.length ? parts.join(", ") : "no fill";
}

function nodeWord(t: string): string {
  switch (t) {
    case "frame":
    case "component":
    case "instance":
      return "frame";
    case "rect":
      return "rectangle";
    case "ellipse":
      return "ellipse";
    case "text":
      return "text";
    case "vector":
    case "line":
      return "vector";
    case "group":
      return "group";
    default:
      return t || "node";
  }
}

/** Build a text narrative for the requested root node of a PDS document. */
export function describePds(doc: PdsDocument): DescribeResult {
  const root = doc.nodes[doc.root];
  if (!root) {
    return {
      root: doc.root,
      box: { w: 0, h: 0 },
      layout: "free",
      narrative: "(root node missing)",
      children: [],
    };
  }

  const rootLayout = resolveLayout(root.layout, doc.tokens);
  const hasAutoLayout = !!rootLayout;
  const kids: PdsNode[] = (root.children ?? [])
    .map((el) => doc.nodes[el])
    .filter((n): n is PdsNode => !!n);

  const summaries: NodeSummary[] = kids.map((k) => {
    const summary: NodeSummary = {
      el: k.el,
      id: k.id,
      name: k.name,
      type: k.type,
      box: k.box,
      appearance: summarizeAppearance(k, doc.tokens),
    };
    if (k.pos) summary.pos = k.pos;
    if (!hasAutoLayout && k.pos) {
      summary.region = regionOf(root.box, k.pos, k.box);
    }
    if (k.chars) {
      // v0.10 Phase 3 — flatten mixed-style runs back to a plain string for
      // the text-only description. The structural runs live on the PDS;
      // describe is a prose summary so the concatenated text is enough.
      summary.chars = typeof k.chars === "string" ? k.chars : k.chars.map((r) => r.t).join("");
    }
    return summary;
  });

  const regions: Partial<Record<Region, string[]>> | undefined = hasAutoLayout
    ? undefined
    : {};
  if (regions) {
    for (const s of summaries) {
      if (!s.region) continue;
      (regions[s.region] ??= []).push(s.el);
    }
  }

  // Build the prose paragraph.
  const lines: string[] = [];
  const rootWord = nodeWord(root.type);
  const header = hasAutoLayout
    ? `The "${root.name}" ${rootWord} is ${root.box.w}×${root.box.h}px — a ${
        rootLayout!.flow === "col" ? "vertical" : "horizontal"
      } auto-layout container`
    : `The "${root.name}" ${rootWord} is ${root.box.w}×${root.box.h}px — a free-form (absolutely-positioned) container`;
  lines.push(
    `${header} with ${kids.length} ${kids.length === 1 ? "child" : "children"}.`,
  );

  if (kids.length > 0) {
    lines.push("");
    for (const s of summaries) {
      const where = s.region
        ? `at the ${s.region}`
        : s.pos
          ? `at (${s.pos.x},${s.pos.y})`
          : "in flow order";
      const text = s.chars ? `, text "${s.chars.slice(0, 64)}${s.chars.length > 64 ? "…" : ""}"` : "";
      lines.push(
        `- ${s.name} (${nodeWord(s.type)}, ${s.box.w}×${s.box.h}) ${where}: ${s.appearance}${text}`,
      );
    }
  }

  return {
    root: root.el,
    box: root.box,
    layout: hasAutoLayout ? "auto" : "free",
    narrative: lines.join("\n"),
    regions,
    children: summaries,
  };
}
