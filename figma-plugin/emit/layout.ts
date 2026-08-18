/// <reference types="@figma/plugin-typings" />

/**
 * Auto-layout, applied AFTER parenting.
 *
 * Order is not stylistic here: Figma resolves `layoutSizing` / `layoutGrow`
 * against a parent that must already have its layout mode set and the child
 * must already be appended, or the assignment silently does nothing.
 */

import type { EmitNode, EmitWarning } from "./wire";
import { tryset } from "./shared";

/* ------------------------------------------------------------------ */
/* Auto-layout (container + per-child) — applied AFTER parenting        */
/* ------------------------------------------------------------------ */

export function applyContainerLayout(node: SceneNode, en: EmitNode, warnings: EmitWarning[], key: string): void {
  const lay = en.layout;
  if (!lay || !("layoutMode" in node)) return;
  const f = node as FrameNode;
  tryset(warnings, key, "layout", () => {
    f.layoutMode = lay.mode;
    if (lay.gap !== undefined) f.itemSpacing = lay.gap;
    f.paddingTop = lay.pad.t;
    f.paddingRight = lay.pad.r;
    f.paddingBottom = lay.pad.b;
    f.paddingLeft = lay.pad.l;
    if (lay.primary) f.primaryAxisAlignItems = lay.primary;
    if (lay.counter) f.counterAxisAlignItems = lay.counter as FrameNode["counterAxisAlignItems"];
    if (lay.wrap) {
      f.layoutWrap = "WRAP";
      if (lay.gapCross !== undefined) f.counterAxisSpacing = lay.gapCross;
    }
  });
}

export function applyChildLayout(node: SceneNode, en: EmitNode, warnings: EmitWarning[], key: string): void {
  const c = en.child;
  if (!c) return;
  const parent = node.parent as unknown as { layoutMode?: string } | null;
  const inAutoLayout = !!parent && !!parent.layoutMode && parent.layoutMode !== "NONE";
  const self = node as unknown as { layoutMode?: string };
  // "HUG" is valid on the node itself if it's an auto-layout frame or text —
  // it does NOT require an auto-layout parent. "FILL"/grow/align do.
  const canHug =
    (!!self.layoutMode && self.layoutMode !== "NONE") || node.type === "TEXT";

  const applySizing = (
    field: "sizingH" | "sizingV",
    prop: "layoutSizingHorizontal" | "layoutSizingVertical",
    val: string | undefined,
  ): void => {
    if (!val) return;
    const allowed = val === "HUG" ? canHug : inAutoLayout; // FILL/FIXED need parent
    if (!allowed) return;
    tryset(warnings, key, field, () => {
      (node as unknown as Record<string, string>)[prop] = val;
    });
  };
  applySizing("sizingH", "layoutSizingHorizontal", c.sizingH);
  applySizing("sizingV", "layoutSizingVertical", c.sizingV);

  if (!inAutoLayout) return; // grow/align only meaningful inside an auto-layout parent
  if (c.grow !== undefined)
    tryset(warnings, key, "grow", () => ((node as unknown as { layoutGrow: number }).layoutGrow = c.grow!));
  if (c.align)
    tryset(
      warnings,
      key,
      "align",
      () => ((node as unknown as { layoutAlign: string }).layoutAlign = c.align!),
    );
}
