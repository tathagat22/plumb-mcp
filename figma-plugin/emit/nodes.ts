/// <reference types="@figma/plugin-typings" />

/**
 * Node creation and property application — the bulk of the executor.
 *
 * One function creates the right Figma node for an `EmitNodeType`; another
 * applies every intrinsic property to it. Text and SVG get their own paths
 * because both have ordering rules Figma enforces (a loaded font before
 * `characters`; a materialised SVG frame before its children).
 */

import type { EmitNode, EmitNodeType, EmitOp, EmitPaint, EmitText, EmitWarning, FontFace } from "./wire";
import type { AssetTables } from "./assets";
import { ensureFace } from "./fonts";
import { toEffects, toPaints } from "./paint";
import { PLUMB_KEY, errText, tryset } from "./shared";

/* ------------------------------------------------------------------ */
/* Node creation + property application                                */
/* ------------------------------------------------------------------ */

export const TYPE_OF_EMIT: Record<EmitNodeType, string[]> = {
  frame: ["FRAME"],
  group: ["FRAME", "GROUP"],
  text: ["TEXT"],
  rect: ["RECTANGLE"],
  ellipse: ["ELLIPSE"],
  line: ["LINE"],
  vector: ["VECTOR"],
  instance: ["INSTANCE"],
  component: ["COMPONENT"],
};

/** True when this node renders an SVG asset — it can't be a paint, so the node
 *  must be a container that hosts a createNodeFromSvg child (see materializeSvg). */
export function hostsSvg(en: EmitNode, assets: AssetTables): boolean {
  const f = (en.fills ?? []).find((x) => x.type === "IMAGE") as
    | { assetRef?: string }
    | undefined;
  return !!f?.assetRef && assets.svgs.has(f.assetRef);
}

export async function createNode(
  op: EmitOp,
  warnings: EmitWarning[],
  assets: AssetTables,
  nodes: Map<string, SceneNode>,
): Promise<SceneNode> {
  const t = op.node.type;
  // A leaf shape can't host the vector realised from an SVG — make it a frame.
  if ((t === "rect" || t === "ellipse" || t === "line" || t === "vector") && hostsSvg(op.node, assets)) {
    return figma.createFrame();
  }
  switch (t) {
    case "text":
      return figma.createText();
    case "rect":
      return figma.createRectangle();
    case "ellipse":
      return figma.createEllipse();
    case "line":
      return figma.createLine();
    case "vector":
      return figma.createVector();
    case "component":
      return figma.createComponent();
    case "instance": {
      const ref = op.node.instanceOf;
      if (ref) {
        // 1. Master built earlier in THIS plan (same-plan reusable component —
        //    ops are applied in DFS order, so the library subtree lands before
        //    any page content that instantiates it).
        const local = nodes.get(ref);
        if (local && local.type === "COMPONENT") return (local as ComponentNode).createInstance();
        // 2. A live node elsewhere in the file, addressed by its Figma node id.
        try {
          const src = await figma.getNodeByIdAsync(ref);
          if (src && src.type === "COMPONENT") return (src as ComponentNode).createInstance();
        } catch {
          /* fall through to placeholder */
        }
        // 3. A published library component, addressed by its component key.
        try {
          const comp = await figma.importComponentByKeyAsync(ref);
          return comp.createInstance();
        } catch {
          /* fall through */
        }
      }
      warnings.push({ key: op.key, field: "instanceOf", message: `component "${ref}" unavailable → frame` });
      return figma.createFrame();
    }
    case "group":
    case "frame":
    default:
      return figma.createFrame();
  }
}

/** Apply everything EXCEPT parenting and child-layout (which need the parent set). */
export async function applyIntrinsic(
  node: SceneNode,
  op: EmitOp,
  assets: AssetTables,
  resolveFont: (f: FontFace) => FontFace,
  warnings: EmitWarning[],
): Promise<void> {
  const en = op.node;
  const key = op.key;

  tryset(warnings, key, "name", () => {
    node.name = en.name ?? node.name;
  });
  tryset(warnings, key, "pluginData", () => node.setPluginData(PLUMB_KEY, key));

  // Text is special: fonts must be loaded before characters.
  if (en.type === "text" && en.text) {
    await applyText(node as TextNode, en.text, en.size, en.fills, assets, resolveFont, warnings, key);
  }

  // Vectors carry explicit path data.
  if (en.type === "vector" && en.vectorPaths) {
    tryset(warnings, key, "vectorPaths", () => {
      (node as VectorNode).vectorPaths = en.vectorPaths!.map((v) => ({
        windingRule: v.windingRule ?? "NONZERO",
        data: v.data,
      }));
    });
  }

  // Size — set FIRST so later auto-layout sizing can override to HUG/FILL. Text
  // sizing is governed by autoResize EXCEPT a fixed box ("NONE"), which must be
  // resized explicitly (resize AFTER characters are set so it isn't clobbered).
  const textFixed = en.type === "text" && (!en.text || en.text.autoResize === "NONE");
  if ((en.type !== "text" || textFixed) && "resize" in node && en.size) {
    tryset(warnings, key, "size", () =>
      (node as unknown as LayoutMixin).resize(
        Math.max(0.01, en.size.w),
        Math.max(0.01, en.size.h),
      ),
    );
  }

  // Fills / strokes. Text nodes are handled inside applyText (base fill before
  // run overrides), so skip them here to avoid clobbering per-span run colours.
  if ("fills" in node && en.fills !== undefined && en.type !== "text") {
    tryset(warnings, key, "fills", () => {
      (node as GeometryMixin).fills = toPaints(en.fills, assets, warnings, key);
    });
  } else if (en.fills === undefined && (node.type === "FRAME" || node.type === "COMPONENT")) {
    // figma.createFrame() defaults to an opaque white fill — a layout container
    // with no authored bg must be transparent, or it paints a white box over a
    // dark page. (svg hosts clear their own fill in materializeSvg.)
    tryset(warnings, key, "fills", () => {
      (node as GeometryMixin).fills = [];
    });
  }
  if ("strokes" in node && en.strokes !== undefined) {
    tryset(warnings, key, "strokes", () => {
      (node as GeometryMixin).strokes = toPaints(en.strokes, assets, warnings, key);
    });
  }
  if (en.strokeWeight !== undefined && "strokeWeight" in node) {
    tryset(warnings, key, "strokeWeight", () => {
      (node as GeometryMixin).strokeWeight = en.strokeWeight!;
    });
  }
  if (en.strokeAlign && "strokeAlign" in node) {
    tryset(warnings, key, "strokeAlign", () => {
      (node as GeometryMixin).strokeAlign = en.strokeAlign!;
    });
  }
  if (en.dashPattern && "dashPattern" in node) {
    tryset(warnings, key, "dashPattern", () => {
      (node as GeometryMixin).dashPattern = en.dashPattern!;
    });
  }
  if (en.strokeSides) {
    const s = en.strokeSides;
    const an = node as unknown as Record<string, unknown>;
    tryset(warnings, key, "strokeSides", () => {
      an.strokeTopWeight = s.t;
      an.strokeRightWeight = s.r;
      an.strokeBottomWeight = s.b;
      an.strokeLeftWeight = s.l;
    });
  }

  // Corner radius.
  if (en.cornerRadius !== undefined) applyRadius(node, en.cornerRadius, warnings, key);

  // Effects.
  if (en.effects !== undefined && "effects" in node) {
    tryset(warnings, key, "effects", () => {
      (node as BlendMixin).effects = toEffects(en.effects);
    });
  }

  // Opacity / blend / rotation / clip.
  if (en.opacity !== undefined && "opacity" in node) {
    tryset(warnings, key, "opacity", () => {
      (node as BlendMixin).opacity = en.opacity!;
    });
  }
  if (en.blendMode && "blendMode" in node) {
    tryset(warnings, key, "blendMode", () => {
      (node as BlendMixin).blendMode = en.blendMode as BlendMode;
    });
  }
  if (en.clip !== undefined && "clipsContent" in node) {
    tryset(warnings, key, "clip", () => {
      (node as FrameNode).clipsContent = en.clip!;
    });
  }
  if (en.rotation !== undefined && "rotation" in node) {
    tryset(warnings, key, "rotation", () => {
      (node as unknown as { rotation: number }).rotation = en.rotation!;
    });
  }

  // Min / max sizing (auto-layout constraints).
  const dim = node as unknown as Record<string, unknown>;
  if (en.minWidth !== undefined) tryset(warnings, key, "minWidth", () => (dim.minWidth = en.minWidth));
  if (en.maxWidth !== undefined) tryset(warnings, key, "maxWidth", () => (dim.maxWidth = en.maxWidth));
  if (en.minHeight !== undefined) tryset(warnings, key, "minHeight", () => (dim.minHeight = en.minHeight));
  if (en.maxHeight !== undefined) tryset(warnings, key, "maxHeight", () => (dim.maxHeight = en.maxHeight));

  // Instance component properties (best-effort).
  if (en.type === "instance" && en.componentProps && node.type === "INSTANCE") {
    tryset(warnings, key, "componentProps", () =>
      (node as InstanceNode).setProperties(en.componentProps as Record<string, string | boolean>),
    );
  }
}

export function applyRadius(
  node: SceneNode,
  r: number | [number, number, number, number],
  warnings: EmitWarning[],
  key: string,
): void {
  const an = node as unknown as Record<string, unknown>;
  if (typeof r === "number") {
    if ("cornerRadius" in node) tryset(warnings, key, "cornerRadius", () => (an.cornerRadius = r));
    return;
  }
  tryset(warnings, key, "cornerRadius", () => {
    an.topLeftRadius = r[0];
    an.topRightRadius = r[1];
    an.bottomRightRadius = r[2];
    an.bottomLeftRadius = r[3];
  });
}

export async function applyText(
  node: TextNode,
  txt: EmitText,
  size: { w: number; h: number } | undefined,
  baseFills: EmitPaint[] | undefined,
  assets: AssetTables,
  resolveFont: (f: FontFace) => FontFace,
  warnings: EmitWarning[],
  key: string,
): Promise<void> {
  const base = resolveFont(txt.font);
  // fontName must reference a LOADED face before characters are assigned.
  try {
    node.fontName = { family: base.family, style: base.style };
  } catch (e) {
    warnings.push({ key, field: "fontName", message: errText(e) });
  }
  tryset(warnings, key, "characters", () => {
    node.characters = txt.characters;
  });
  tryset(warnings, key, "fontSize", () => {
    node.fontSize = txt.fontSize;
  });
  if (txt.lineHeightPx !== undefined) {
    tryset(warnings, key, "lineHeight", () => {
      node.lineHeight = { value: txt.lineHeightPx!, unit: "PIXELS" };
    });
  }
  if (txt.letterSpacing !== undefined) {
    tryset(warnings, key, "letterSpacing", () => {
      node.letterSpacing = { value: txt.letterSpacing!, unit: "PIXELS" };
    });
  }
  if (txt.align) {
    tryset(warnings, key, "align", () => {
      node.textAlignHorizontal = txt.align!;
    });
  }
  if (txt.decoration) {
    tryset(warnings, key, "decoration", () => {
      node.textDecoration = txt.decoration!;
    });
  }
  if (txt.autoResize) {
    if (txt.autoResize === "TRUNCATE") {
      tryset(warnings, key, "autoResize", () => {
        node.textAutoResize = "HEIGHT";
        (node as unknown as { textTruncate: string }).textTruncate = "ENDING";
      });
    } else {
      tryset(warnings, key, "autoResize", () => {
        node.textAutoResize = txt.autoResize as "NONE" | "HEIGHT" | "WIDTH_AND_HEIGHT";
      });
    }
  }

  // Fixed-width modes ("HEIGHT"/"TRUNCATE") need the width applied explicitly —
  // Figma auto-computes the height. Must run AFTER textAutoResize is set, else a
  // fresh node's default WIDTH_AND_HEIGHT ignores the resize. ("NONE" is resized
  // as a fixed box in the intrinsic-size step; "WIDTH_AND_HEIGHT" hugs, no resize.)
  if (
    size &&
    (txt.autoResize === "HEIGHT" || txt.autoResize === "TRUNCATE")
  ) {
    tryset(warnings, key, "textWidth", () =>
      node.resize(Math.max(0.01, size.w), Math.max(0.01, node.height)),
    );
  }

  // Base (whole-node) fill must be set BEFORE run overrides, or the per-span
  // run.fills below get clobbered. applyIntrinsic's general fills block skips
  // text nodes for exactly this reason, delegating the base fill to here.
  if (baseFills !== undefined) {
    tryset(warnings, key, "fills", () => {
      node.fills = toPaints(baseFills, assets, warnings, key);
    });
  }

  // Mixed-style runs — each range font must also be loaded.
  if (txt.runs && txt.runs.length) {
    for (const run of txt.runs) {
      const lo = Math.max(0, run.start);
      const hi = Math.min(txt.characters.length, run.end);
      if (hi <= lo) continue;
      if (run.font) {
        const rf = await ensureFace(resolveFont(run.font), resolveFont, warnings);
        tryset(warnings, key, "run.font", () =>
          node.setRangeFontName(lo, hi, { family: rf.family, style: rf.style }),
        );
      }
      if (run.fontSize !== undefined)
        tryset(warnings, key, "run.fontSize", () => node.setRangeFontSize(lo, hi, run.fontSize!));
      if (run.fills)
        tryset(warnings, key, "run.fills", () =>
          node.setRangeFills(lo, hi, toPaints(run.fills, assets, warnings, key)),
        );
      if (run.lineHeightPx !== undefined)
        tryset(warnings, key, "run.lineHeight", () =>
          node.setRangeLineHeight(lo, hi, { value: run.lineHeightPx!, unit: "PIXELS" }),
        );
      if (run.letterSpacing !== undefined)
        tryset(warnings, key, "run.letterSpacing", () =>
          node.setRangeLetterSpacing(lo, hi, { value: run.letterSpacing!, unit: "PIXELS" }),
        );
      if (run.decoration)
        tryset(warnings, key, "run.decoration", () =>
          node.setRangeTextDecoration(lo, hi, run.decoration!),
        );
    }
  }
}

/**
 * An IMAGE fill whose ref points to an SVG asset can't be a paint — realise it
 * as a child node via createNodeFromSvg, sized to fill the parent. Returns true
 * if an svg was materialised (so the caller knows the node hosts vector art).
 */
export function materializeSvg(
  node: SceneNode,
  op: EmitOp,
  assets: AssetTables,
  warnings: EmitWarning[],
): void {
  const en = op.node;
  const imgFill = (en.fills ?? []).find((f) => f.type === "IMAGE") as
    | { type: "IMAGE"; assetRef: string }
    | undefined;
  if (!imgFill) return;
  const svg = assets.svgs.get(imgFill.assetRef);
  if (!svg) return;
  if (!("appendChild" in node)) {
    warnings.push({ key: op.key, field: "svg", message: "svg target is not a container" });
    return;
  }
  try {
    // The host node is a dedicated SVG host (see createNode) — on a sync
    // re-apply it is REUSED, so clear any vector child we materialised last pass
    // before adding the fresh one, or icons stack and double on every re-apply.
    if ("children" in node) {
      for (const child of [...(node as ChildrenMixin).children]) child.remove();
    }
    // Drop its default fill so no white box shows behind the (often transparent)
    // icon, and don't clip it — unless the author explicitly asked to clip.
    if ("fills" in node) (node as GeometryMixin).fills = [];
    if ("clipsContent" in node && en.clip === undefined) (node as FrameNode).clipsContent = false;
    const frame = figma.createNodeFromSvg(svg);
    frame.name = en.name ?? frame.name;
    frame.resize(Math.max(0.01, en.size.w), Math.max(0.01, en.size.h));
    (node as ChildrenMixin).appendChild(frame);
    frame.x = 0;
    frame.y = 0;
  } catch (e) {
    warnings.push({ key: op.key, field: "svg", message: errText(e) });
  }
}
