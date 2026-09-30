import { PlumbError } from "../errors";
import { estimateTokens } from "../util/estimate";
import { HandleMinter } from "../normalize/handles";
import { requestFullInventory } from "./server";
import { bridge } from "./store";

/** Whether the pushed inventory leaves out pages the plugin hasn't loaded. */
export function inventoryIsPartial(): boolean {
  return !!bridge.inventory?.pages.some((p) => p.loaded === false);
}

let fullLoad: Promise<void> | null = null;

/**
 * Make sure every page's screens are known. The plugin only loads the page
 * you're on (loading a whole large file costs Figma a lot of memory), so the
 * first tool that needs the whole file — outline, or a screen looked up by
 * name — asks for the rest here. Concurrent callers share one request, and a
 * complete inventory is a no-op. On failure the partial inventory stands.
 */
export async function ensureFullInventory(): Promise<void> {
  if (!bridge.paired || !inventoryIsPartial()) return;
  if (!fullLoad) {
    fullLoad = (async () => {
      const { fileName, pages, error } = await requestFullInventory();
      if (error) {
        throw new PlumbError(
          `The plugin could not load the file's pages: ${error}`,
          "Retry; if it persists, re-run the Plumb plugin in Figma.",
        );
      }
      // Loading pages doesn't change the file, so the fileVersion (and the
      // node cache keyed on it) stays as is.
      bridge.inventory = { fileName, pages };
    })().finally(() => {
      fullLoad = null;
    });
  }
  return fullLoad;
}

/** One screen in a flattened, page-annotated list (internal shape). */
export interface ScreenMatch {
  id: string;
  name: string;
  page: string;
  w: number;
  h: number;
}

/** Agent-facing row shape: PDS-consistent `box: {w,h}`, page surfaced. */
export interface ScreenMatchRow {
  id: string;
  name: string;
  page: string;
  box: { w: number; h: number };
}

export function formatScreenMatches(matches: ScreenMatch[]): ScreenMatchRow[] {
  return matches.map((m) => ({
    id: m.id,
    name: m.name,
    page: m.page,
    box: { w: m.w, h: m.h },
  }));
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
export async function resolveScreen(
  id: string | undefined,
  name: string | undefined,
): Promise<{ id: string } | { ambiguous: ScreenMatch[] }> {
  if (id) return { id };
  if (!name) {
    throw new PlumbError(
      "Provide a screen `id` or `name`.",
      "Call plumb_outline to list the available screen names and ids.",
    );
  }
  // A name can match a screen on any page, so every page has to be known.
  await ensureFullInventory();
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
export async function pluginOutline(): Promise<unknown> {
  await ensureFullInventory();
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
