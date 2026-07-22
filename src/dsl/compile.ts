/**
 * `compile(doc, ctx)` — the DSL → PDS compiler entrypoint.
 *
 * Lowers a validated Design DSL document (src/dsl/schema.ts) DOWN to a
 * PdsDocument (src/pds.ts) that is byte-shape identical to what `normalize()`
 * produces from Figma — same token encodings, same flat `el`-keyed node map —
 * so the existing verify/fit path round-trips against it unchanged.
 *
 * Pipeline (blueprint §7): tokens → sections → components/blocks → layout →
 * assemble. Assets are batch-resolved up front (deduped by query/kind/seed) and
 * any rejection degrades to a placeholder rather than failing the page.
 */

import { assetCacheKey, lowerBlock, normalizeAssetSpec } from "./blocks";
import { expandInstance, indexComponents } from "./components";
import { lowerSection } from "./sections";
import { TokenCtx } from "./tokens";
import { HandleMinter } from "../normalize/handles";
import { estimateTokens } from "../util/estimate";
import type { LowerCtx } from "./blocks";
import { PDS_SCHEMA_VERSION } from "../pds";
import type { PdsDocument, PdsNode } from "../pds";
import type {
  AssetResolver,
  AssetSpec,
  Block,
  Brand,
  Component,
  DesignDoc,
  Instance,
  Page,
  PropDef,
  ResolvedAsset,
  Stack,
  TextMeasurer,
} from "./schema";

/** Injected dependencies the compiler needs but does not own. */
export interface CompileContext {
  assets: AssetResolver;
  measure?: TextMeasurer;
  page?: { width?: number };
}

/** Everything a compile run produces. */
export interface CompileResult {
  /** The lowered spec — identical shape to `normalize()`'s output. */
  doc: PdsDocument;
  /** name → { dsl component id, representative root el, prop defs }. */
  components: Record<string, { id: string; el: string; props: PropDef[] }>;
  /** Every unique asset the design references (for the asset engine / tooling). */
  assetRequests: AssetSpec[];
  /** Non-fatal degradations (unresolved assets, unknown components, …). */
  warnings: string[];
}

const DEFAULT_PAGE_WIDTH = 1440;

export async function compile(doc: DesignDoc, ctx: CompileContext): Promise<CompileResult> {
  const warnings: string[] = [];
  const tokens = new TokenCtx(doc.brand);
  const componentIndex = indexComponents(doc.components);
  const pageWidth = ctx.page?.width ?? DEFAULT_PAGE_WIDTH;

  // 1. Expand every page's sections to a page-level container Block.
  const pageBlocks = doc.pages.map((page) => ({
    page,
    block: pageToBlock(page, pageWidth, doc.brand),
  }));

  // 2. Collect + batch-resolve unique assets (never let a failure kill the page).
  const specByKey = new Map<string, AssetSpec>();
  for (const { block } of pageBlocks) collectAssets(block, componentIndex, specByKey);
  const resolved = await resolveAssets(specByKey, ctx.assets, warnings);

  // 3. Lower everything into one flat node map.
  const nodes: Record<string, PdsNode> = {};
  const minter = new HandleMinter();
  const sidecar: Record<string, { id: string; el: string; props: PropDef[] }> = {};
  seedSidecar(doc.components, sidecar);

  const lowerCtx: LowerCtx = {
    tokens,
    brand: doc.brand,
    minter,
    nodes,
    assets: resolved,
    measurer: ctx.measure,
    expandInstance: (inst: Instance) => expandInstance(inst, componentIndex),
    onComponentInstance: (name, el) => {
      const entry = sidecar[name];
      if (entry && !entry.el) entry.el = el;
    },
    components: componentIndex,
    componentMasters: new Map(),
    componentLibraryEls: [],
    warnings,
  };

  const roots: string[] = [];
  for (const { page, block } of pageBlocks) {
    const width = typeof page.width === "number" ? page.width : pageWidth;
    roots.push(lowerBlock(block, lowerCtx, width).el);
  }

  // Real component masters (built lazily while lowering pages above) land
  // under one off-canvas library frame, placed FIRST so it's visited before
  // any page content that instantiates it — DFS ops order = plugin creation
  // order, and an instance must find its main component already built.
  const allRoots = lowerCtx.componentLibraryEls.length
    ? [buildComponentLibraryFrame(lowerCtx.componentLibraryEls, lowerCtx), ...roots]
    : roots;

  // 4. Single root: use the page directly; multi-page (or a component
  // library present): a canvas wrapper.
  const root = allRoots.length === 1 ? allRoots[0]! : buildCanvas(allRoots, lowerCtx, pageWidth);

  const table = tokens.table();
  const estTokens = estimateTokens(JSON.stringify({ tokens: table, nodes }));

  const pdsDoc: PdsDocument = {
    schemaVersion: PDS_SCHEMA_VERSION,
    file: { name: doc.meta?.name ?? "Untitled", version: doc.version },
    root,
    tokens: table,
    nodes,
    meta: {
      nodeCount: Object.keys(nodes).length,
      estTokens,
      depthUsed: depthOf(root, nodes),
    },
    next:
      "Compiled from the Plumb Design DSL. Read `tokens` for the design system, " +
      "then resolve `assetRequests`, lower to an EmitPlan, and apply-design. " +
      "Re-serialize the built nodes and run plumb_verify to confirm the match.",
  };

  return { doc: pdsDoc, components: sidecar, assetRequests: [...specByKey.values()], warnings };
}

/* ------------------------------------------------------------------------ */
/* Page assembly                                                              */
/* ------------------------------------------------------------------------ */

function pageToBlock(page: Page, defaultWidth: number, brand: Brand): Stack {
  const children: Block[] = page.sections.map((s) => lowerSection(s, { brand }));
  return {
    type: "stack",
    id: page.id ?? page.name,
    name: page.name,
    dir: "col",
    w: page.width ?? defaultWidth,
    ...(typeof page.height === "number" ? { h: page.height } : {}),
    ...(page.bg !== undefined ? { bg: page.bg } : {}),
    children,
  };
}

/** Group every master component built this compile under one labelled,
 *  auto-layout frame — a real, inspectable "Components" section rather than
 *  loose orphan nodes. Attached as a sibling root alongside the page(s). */
function buildComponentLibraryFrame(els: string[], ctx: LowerCtx): string {
  const el = ctx.minter.mint("components", "frame");
  const kids = els.map((e) => ctx.nodes[e]).filter((n): n is PdsNode => Boolean(n));
  const gap = 40;
  const pad: [number, number, number, number] = [40, 40, 40, 40];
  const innerW = kids.reduce((m, n) => Math.max(m, n.box.w), 0);
  const innerH = kids.reduce((s, n) => s + n.box.h, 0) + gap * Math.max(kids.length - 1, 0);
  ctx.nodes[el] = {
    id: `dsl:${el}`,
    el,
    type: "frame",
    name: "Components",
    box: { w: innerW + pad[1] + pad[3], h: innerH + pad[0] + pad[2] },
    layout: { flow: "col", pad, gap },
    children: els,
  };
  return el;
}

function buildCanvas(pageEls: string[], ctx: LowerCtx, width: number): string {
  const el = ctx.minter.mint("canvas", "frame");
  const kids = pageEls.map((p) => ctx.nodes[p]).filter((n): n is PdsNode => Boolean(n));
  const totalH = kids.reduce((s, n) => s + n.box.h, 0) + 80 * Math.max(kids.length - 1, 0);
  ctx.nodes[el] = {
    id: `dsl:${el}`,
    el,
    type: "frame",
    box: { w: width, h: totalH },
    layout: { flow: "col", pad: [0, 0, 0, 0], gap: 80 },
    children: pageEls,
  };
  return el;
}

/* ------------------------------------------------------------------------ */
/* Asset collection + resolution                                             */
/* ------------------------------------------------------------------------ */

function collectAssets(
  block: Block,
  components: Map<string, Component>,
  out: Map<string, AssetSpec>,
): void {
  switch (block.type) {
    case "image": {
      const spec = normalizeAssetSpec(block.src, { kind: "photo", role: "card-image" });
      out.set(assetCacheKey(spec), spec);
      break;
    }
    case "icon": {
      const spec: AssetSpec = { query: block.name, kind: "icon", role: "icon" };
      out.set(assetCacheKey(spec), spec);
      break;
    }
    case "button": {
      if (block.icon) {
        const spec: AssetSpec = { query: block.icon, kind: "icon", role: "icon" };
        out.set(assetCacheKey(spec), spec);
      }
      break;
    }
    case "stack": {
      for (const child of block.children) collectAssets(child, components, out);
      break;
    }
    case "instance": {
      const expanded = expandInstance(block, components);
      if (expanded) collectAssets(expanded.block, components, out);
      break;
    }
    default:
      break;
  }
}

async function resolveAssets(
  specByKey: Map<string, AssetSpec>,
  resolver: AssetResolver,
  warnings: string[],
): Promise<Map<string, ResolvedAsset>> {
  const out = new Map<string, ResolvedAsset>();
  const entries = [...specByKey.entries()];
  const results = await Promise.all(
    entries.map(async ([key, spec]) => {
      try {
        return [key, await resolver.resolve(spec)] as const;
      } catch (e) {
        warnings.push(`asset resolve failed for "${spec.query}": ${errMsg(e)}`);
        return [key, null] as const;
      }
    }),
  );
  for (const [key, res] of results) if (res) out.set(key, res);
  return out;
}

/* ------------------------------------------------------------------------ */
/* Sidecar + meta helpers                                                     */
/* ------------------------------------------------------------------------ */

function seedSidecar(
  components: Component[] | undefined,
  sidecar: Record<string, { id: string; el: string; props: PropDef[] }>,
): void {
  for (const c of components ?? []) {
    sidecar[c.name] = { id: `dsl:${c.name}`, el: "", props: c.props ?? [] };
  }
}

/** Max node depth from a root — mirrors `meta.depthUsed` from normalize. */
function depthOf(root: string, nodes: Record<string, PdsNode>): number {
  const walk = (el: string, seen: Set<string>): number => {
    if (seen.has(el)) return 0;
    seen.add(el);
    const node = nodes[el];
    if (!node?.children?.length) return 1;
    return 1 + Math.max(...node.children.map((c) => walk(c, seen)));
  };
  return walk(root, new Set());
}

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
