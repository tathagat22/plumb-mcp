/// <reference types="@figma/plugin-typings" />

/**
 * Target resolution and the sync index.
 *
 * An apply can create a new tree or update one it made earlier; this decides
 * which, by finding nodes previously stamped with their authored `el` key.
 */

import type { EmitNodeType, EmitTarget, EmitWarning } from "./wire";
import { PLUMB_KEY } from "./shared";
import { TYPE_OF_EMIT } from "./nodes";

/* ------------------------------------------------------------------ */
/* Target resolution + sync index                                      */
/* ------------------------------------------------------------------ */

export interface Target {
  container: BaseNode & ChildrenMixin;
  /** For "replace": the node whose place we take (removed after new root lands). */
  replaced: SceneNode | null;
  pos: { x: number; y: number } | null;
}

export async function resolveTarget(target: EmitTarget, warnings: EmitWarning[]): Promise<Target> {
  if (target.kind === "into") {
    const n = await figma.getNodeByIdAsync(target.nodeId);
    if (n && "appendChild" in n) {
      return { container: n as BaseNode & ChildrenMixin, replaced: null, pos: null };
    }
    warnings.push({ key: "@target", field: "into", message: "target node not found → current page" });
    return { container: figma.currentPage, replaced: null, pos: null };
  }
  if (target.kind === "replace") {
    const n = await figma.getNodeByIdAsync(target.nodeId);
    if (n && n.parent && "appendChild" in n.parent) {
      const sn = n as SceneNode;
      return {
        container: n.parent as BaseNode & ChildrenMixin,
        replaced: sn,
        pos: "x" in sn ? { x: (sn as LayoutMixin).x, y: (sn as LayoutMixin).y } : null,
      };
    }
    warnings.push({ key: "@target", field: "replace", message: "target node not found → current page" });
    return { container: figma.currentPage, replaced: null, pos: null };
  }
  // page — optionally onto a named page, creating it if absent.
  if (target.pageName) {
    let page = figma.root.children.find(
      (p) => p.type === "PAGE" && p.name === target.pageName,
    ) as PageNode | undefined;
    if (!page) {
      page = figma.createPage();
      page.name = target.pageName;
    }
    // dynamic-page access: load the page before touching its children, and use
    // the async setter (assigning figma.currentPage is disallowed in this mode).
    try {
      await page.loadAsync();
    } catch {
      /* fresh pages need no load */
    }
    try {
      await figma.setCurrentPageAsync(page);
    } catch {
      /* best-effort: still build into the page even if we can't switch to it */
    }
    return { container: page, replaced: null, pos: target.pos ?? { x: 0, y: 0 } };
  }
  return {
    container: figma.currentPage,
    replaced: null,
    pos: target.pos ?? { x: 0, y: 0 },
  };
}

/** Index existing keyed nodes under a container (sync mode reuse). */
export function indexByKey(container: BaseNode & ChildrenMixin): Map<string, SceneNode> {
  const map = new Map<string, SceneNode>();
  function walk(n: BaseNode): void {
    if ((n as SceneNode).getPluginData) {
      const k = (n as SceneNode).getPluginData(PLUMB_KEY);
      if (k) map.set(k, n as SceneNode);
    }
    if ("children" in n) {
      for (const c of (n as ChildrenMixin).children) walk(c);
    }
  }
  for (const c of container.children) walk(c);
  return map;
}

export function emitTypeMatches(node: SceneNode, t: EmitNodeType): boolean {
  return (TYPE_OF_EMIT[t] ?? []).indexOf(node.type) !== -1;
}
