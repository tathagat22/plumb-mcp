import { PlumbError } from "../errors";
import { estimateTokens } from "../util/estimate";
import { HandleMinter } from "../normalize/handles";
import { bridge } from "./store";

/** One screen in a flattened, page-annotated list. */
export interface ScreenMatch {
  id: string;
  name: string;
  page: string;
  w: number;
  h: number;
}

/** All screens across all pages, flattened. */
export function flatScreens(): ScreenMatch[] {
  const out: ScreenMatch[] = [];
  if (!bridge.inventory) return out;
  for (const page of bridge.inventory.pages) {
    for (const f of page.frames) {
      out.push({ id: f.id, name: f.name, page: page.name, w: f.w, h: f.h });
    }
  }
  return out;
}

/** The name of a screen by id, or "" if unknown. */
export function screenName(id: string): string {
  return flatScreens().find((s) => s.id === id)?.name ?? "";
}

/**
 * Resolve a screen by id or name against the plugin inventory.
 * - id given → that id.
 * - name with exactly one match → that screen.
 * - name with several matches → `{ ambiguous }` so the agent can ask the user.
 * - no match / no input → a PlumbError.
 */
export function resolveScreen(
  id: string | undefined,
  name: string | undefined,
): { id: string } | { ambiguous: ScreenMatch[] } {
  if (id) return { id };
  if (!name) {
    throw new PlumbError(
      "Provide a screen `id` or `name`.",
      "Call plumb_outline to list the available screen names and ids.",
    );
  }
  const q = name.trim().toLowerCase();
  const screens = flatScreens();
  let matches = screens.filter((s) => s.name.toLowerCase() === q);
  if (matches.length === 0) {
    matches = screens.filter((s) => s.name.toLowerCase().includes(q));
  }
  if (matches.length === 0) {
    throw new PlumbError(
      `No screen matches "${name}".`,
      "Call plumb_outline to see the available screen names.",
    );
  }
  if (matches.length === 1) return { id: matches[0]!.id };
  return { ambiguous: matches };
}

/** The plugin-path equivalent of plumb_outline: the live screen inventory. */
export function pluginOutline(): unknown {
  const inv = bridge.inventory;
  if (!inv) {
    throw new PlumbError(
      "The Plumb plugin is paired, but it has not sent the file inventory yet.",
      "Wait a moment and retry; if it persists, re-run the plugin in Figma.",
    );
  }
  const minter = new HandleMinter();
  const pages = inv.pages.map((page) => ({
    name: page.name,
    screens: page.frames.map((f) => ({
      id: f.id,
      el: minter.mint(f.name, "frame"),
      name: f.name,
      box: { w: f.w, h: f.h },
    })),
  }));
  const screenCount = pages.reduce((n, p) => n + p.screens.length, 0);
  const outline = {
    source: "plugin" as const,
    file: { name: inv.fileName },
    pages,
    meta: { pageCount: pages.length, screenCount, estTokens: 0 },
    next:
      "Call plumb_node with a screen `id` (or `name`) to extract it, and " +
      "plumb_assets with the same id to export its icons and images.",
  };
  outline.meta.estTokens = estimateTokens(JSON.stringify(outline));
  return outline;
}
