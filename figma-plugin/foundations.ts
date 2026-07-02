/// <reference types="@figma/plugin-typings" />

/**
 * Plumb plugin — WRITE path: foundations executor (main thread).
 *
 * `applyFoundations(plan)` materialises the design system PRIMITIVES that the
 * geometry pass then binds against: Figma Variable collections (colour + float,
 * multi-mode, with aliases), text styles, effect styles and grid styles.
 * Server-side synthesis (`src/design/synth.ts`) produces the plan; this module
 * is mechanical — it creates/updates the resources and returns their ids so the
 * emit + motion passes and downstream `boundVars` references can resolve.
 *
 * Runs FIRST in the write sequence (apply-foundations → apply-design →
 * apply-motion). It is idempotent: an existing collection/style with the same
 * name is reused and updated in place rather than duplicated.
 *
 * `dryRun` validates + reports what WOULD be created without mutating the file
 * (used by the orchestrator to preview a foundations plan).
 *
 * Wire types below MIRROR src/bridge/protocol.ts §2 (canonical home); declared
 * locally so the file compiles standalone in the plugin's isolated tsconfig.
 */

/* ------------------------------------------------------------------ */
/* Wire contract (mirror of src/bridge/protocol.ts §2)                 */
/* ------------------------------------------------------------------ */

export type VarValue = { hex: string } | { number: number } | { alias: string };

export interface VarSpec {
  /** "primary/500" — slash is a Figma variable group. */
  name: string;
  type: "COLOR" | "FLOAT";
  /** modeName → literal value or alias to another variable (by name). */
  values: Record<string, VarValue>;
  scopes?: string[];
}

export interface VarCollectionSpec {
  name: string;
  modes: string[];
  variables: VarSpec[];
}

export interface TextStyleSpec {
  name: string;
  family: string;
  weight: number;
  sizePx: number;
  lineHeightPercent?: number;
  letterSpacingPx?: number;
  textCase?: "ORIGINAL" | "UPPER";
  /** variable NAMEs to bind (resolved to ids after variable creation). */
  boundVars?: { fontSize?: string; lineHeight?: string };
}

export interface ShadowEffectWire {
  type: "drop-shadow" | "inner-shadow";
  x: number;
  y: number;
  blur: number;
  spread: number;
  color: string;
}

export interface EffectStyleSpec {
  name: string;
  effects: ShadowEffectWire[];
}

export interface GridStyleSpec {
  name: string;
  pattern: "COLUMNS" | "GRID" | "ROWS";
  count?: number;
  gutterPx?: number;
  marginPx?: number;
  sectionSizePx?: number;
  alignment?: "STRETCH" | "CENTER" | "MIN" | "MAX";
}

export interface FoundationsPlan {
  collections: VarCollectionSpec[];
  textStyles: TextStyleSpec[];
  effectStyles: EffectStyleSpec[];
  gridStyles: GridStyleSpec[];
}

export interface FoundationsResult {
  collections: {
    name: string;
    id: string;
    modeIds: Record<string, string>;
    variableIds: Record<string, string>;
  }[];
  textStyleIds: Record<string, string>;
  effectStyleIds: Record<string, string>;
  gridStyleIds: Record<string, string>;
  warnings: string[];
}

/* ------------------------------------------------------------------ */
/* Weight → Figma style-name map (mirror of code.ts WEIGHTS, inverted)  */
/* ------------------------------------------------------------------ */

const STYLE_FOR_WEIGHT: Record<number, string> = {
  100: "Thin",
  200: "Extra Light",
  300: "Light",
  400: "Regular",
  500: "Medium",
  600: "Semi Bold",
  700: "Bold",
  800: "Extra Bold",
  900: "Black",
};

const FALLBACK_FAMILY = "Inter";

function styleForWeight(w: number): string {
  const rounded = (Math.round(w / 100) * 100) as number;
  return STYLE_FOR_WEIGHT[rounded] ?? "Regular";
}

/* ------------------------------------------------------------------ */
/* Colour parsing (hex → Figma RGBA 0..1). Server normally hands hex;   */
/* we keep the tiny parser here so a stray "#rgb"/"#rrggbbaa" is safe.   */
/* ------------------------------------------------------------------ */

function hexToRgba(hex: string): { r: number; g: number; b: number; a: number } {
  let h = hex.trim().replace(/^#/, "");
  if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  if (h.length === 4)
    h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2] + h[3] + h[3];
  const r = parseInt(h.slice(0, 2), 16) / 255;
  const g = parseInt(h.slice(2, 4), 16) / 255;
  const b = parseInt(h.slice(4, 6), 16) / 255;
  const a = h.length >= 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1;
  return {
    r: isNaN(r) ? 0 : r,
    g: isNaN(g) ? 0 : g,
    b: isNaN(b) ? 0 : b,
    a: isNaN(a) ? 1 : a,
  };
}

function errText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/* ------------------------------------------------------------------ */
/* Variable collections                                                */
/* ------------------------------------------------------------------ */

interface BuiltCollection {
  spec: VarCollectionSpec;
  collection: VariableCollection;
  modeIds: Record<string, string>;
  variables: Map<string, Variable>; // name → variable
}

async function ensureCollection(
  spec: VarCollectionSpec,
  warnings: string[],
): Promise<BuiltCollection> {
  const all = await figma.variables.getLocalVariableCollectionsAsync();
  let collection = all.find((c) => c.name === spec.name) ?? null;
  if (!collection) collection = figma.variables.createVariableCollection(spec.name);

  // Modes — the collection is created with one default mode we rename, then add
  // the rest. Reuse modes with matching names.
  const modeIds: Record<string, string> = {};
  const wanted = spec.modes.length ? spec.modes : ["Mode 1"];
  const existingModes = collection.modes.slice();
  wanted.forEach((name, idx) => {
    const found = existingModes.find((m) => m.name === name);
    if (found) {
      modeIds[name] = found.modeId;
      return;
    }
    if (idx === 0 && existingModes.length) {
      // Rename the auto-created default mode to the first wanted mode.
      try {
        collection!.renameMode(existingModes[0].modeId, name);
        modeIds[name] = existingModes[0].modeId;
        return;
      } catch {
        /* fall through to addMode */
      }
    }
    try {
      modeIds[name] = collection!.addMode(name);
    } catch (e) {
      warnings.push(`mode "${name}" in "${spec.name}": ${errText(e)}`);
    }
  });

  // Variables (create only; values are set in a second pass so aliases resolve).
  const existingVars = await figma.variables.getLocalVariablesAsync();
  const byName = new Map<string, Variable>();
  for (const spv of spec.variables) {
    let v = existingVars.find(
      (x) => x.name === spv.name && x.variableCollectionId === collection!.id,
    );
    if (!v) {
      try {
        v = figma.variables.createVariable(spv.name, collection, spv.type);
      } catch (e) {
        warnings.push(`variable "${spv.name}": ${errText(e)}`);
        continue;
      }
    }
    if (spv.scopes && spv.scopes.length) {
      try {
        v.scopes = spv.scopes as VariableScope[];
      } catch {
        /* scopes are advisory */
      }
    }
    byName.set(spv.name, v);
  }

  return { spec, collection, modeIds, variables: byName };
}

/** Second pass: set every variable value per mode, resolving aliases by name. */
function setVariableValues(
  built: BuiltCollection,
  nameIndex: Map<string, Variable>,
  warnings: string[],
): void {
  for (const spv of built.spec.variables) {
    const v = built.variables.get(spv.name);
    if (!v) continue;
    for (const [modeName, value] of Object.entries(spv.values)) {
      const modeId = built.modeIds[modeName];
      if (!modeId) {
        warnings.push(`variable "${spv.name}" references unknown mode "${modeName}"`);
        continue;
      }
      try {
        if ("alias" in value) {
          const target = nameIndex.get(value.alias);
          if (!target) {
            warnings.push(`alias "${value.alias}" (from "${spv.name}") not found`);
            continue;
          }
          v.setValueForMode(modeId, figma.variables.createVariableAlias(target));
        } else if ("hex" in value) {
          v.setValueForMode(modeId, hexToRgba(value.hex));
        } else {
          v.setValueForMode(modeId, value.number);
        }
      } catch (e) {
        warnings.push(`set "${spv.name}"[${modeName}]: ${errText(e)}`);
      }
    }
  }
}

/* ------------------------------------------------------------------ */
/* Text / effect / grid styles                                         */
/* ------------------------------------------------------------------ */

async function ensureTextStyles(
  specs: TextStyleSpec[],
  nameIndex: Map<string, Variable>,
  warnings: string[],
): Promise<Record<string, string>> {
  const ids: Record<string, string> = {};
  const existing = await figma.getLocalTextStylesAsync();
  for (const s of specs) {
    let style = existing.find((x) => x.name === s.name) ?? null;
    if (!style) style = figma.createTextStyle();
    style.name = s.name;

    // Load the requested face (fallback → Inter Regular) before assigning it.
    const desiredStyle = styleForWeight(s.weight);
    let face: FontName = { family: s.family, style: desiredStyle };
    try {
      await figma.loadFontAsync(face);
    } catch {
      face = { family: FALLBACK_FAMILY, style: "Regular" };
      try {
        await figma.loadFontAsync(face);
        warnings.push(`text style "${s.name}": "${s.family} ${desiredStyle}" → Inter Regular`);
      } catch (e) {
        warnings.push(`text style "${s.name}" font load failed: ${errText(e)}`);
      }
    }
    try {
      style.fontName = face;
      style.fontSize = s.sizePx;
      if (s.lineHeightPercent !== undefined)
        style.lineHeight = { value: s.lineHeightPercent, unit: "PERCENT" };
      if (s.letterSpacingPx !== undefined)
        style.letterSpacing = { value: s.letterSpacingPx, unit: "PIXELS" };
      if (s.textCase) style.textCase = s.textCase === "UPPER" ? "UPPER" : "ORIGINAL";
    } catch (e) {
      warnings.push(`text style "${s.name}": ${errText(e)}`);
    }

    // Bind fontSize / lineHeight to variables (best-effort).
    if (s.boundVars) {
      if (s.boundVars.fontSize) bindStyleVar(style, "fontSize", s.boundVars.fontSize, nameIndex, warnings);
      if (s.boundVars.lineHeight)
        bindStyleVar(style, "lineHeight", s.boundVars.lineHeight, nameIndex, warnings);
    }

    ids[s.name] = style.id;
  }
  return ids;
}

function bindStyleVar(
  style: TextStyle,
  field: "fontSize" | "lineHeight",
  varName: string,
  nameIndex: Map<string, Variable>,
  warnings: string[],
): void {
  const v = nameIndex.get(varName);
  if (!v) {
    warnings.push(`text style bound var "${varName}" not found`);
    return;
  }
  try {
    (style as unknown as {
      setBoundVariable: (f: string, val: Variable) => void;
    }).setBoundVariable(field, v);
  } catch (e) {
    warnings.push(`bind "${varName}" → ${field}: ${errText(e)}`);
  }
}

async function ensureEffectStyles(
  specs: EffectStyleSpec[],
  warnings: string[],
): Promise<Record<string, string>> {
  const ids: Record<string, string> = {};
  const existing = await figma.getLocalEffectStylesAsync();
  for (const s of specs) {
    let style = existing.find((x) => x.name === s.name) ?? null;
    if (!style) style = figma.createEffectStyle();
    style.name = s.name;
    try {
      style.effects = s.effects.map((e) => {
        const c = hexToRgba(e.color);
        return {
          type: e.type === "inner-shadow" ? "INNER_SHADOW" : "DROP_SHADOW",
          color: c,
          offset: { x: e.x, y: e.y },
          radius: e.blur,
          spread: e.spread,
          visible: true,
          blendMode: "NORMAL",
        } as DropShadowEffect;
      });
    } catch (e) {
      warnings.push(`effect style "${s.name}": ${errText(e)}`);
    }
    ids[s.name] = style.id;
  }
  return ids;
}

async function ensureGridStyles(
  specs: GridStyleSpec[],
  warnings: string[],
): Promise<Record<string, string>> {
  const ids: Record<string, string> = {};
  const existing = await figma.getLocalGridStylesAsync();
  for (const s of specs) {
    let style = existing.find((x) => x.name === s.name) ?? null;
    if (!style) style = figma.createGridStyle();
    style.name = s.name;
    try {
      const grid: RowsColsLayoutGrid | GridLayoutGrid =
        s.pattern === "GRID"
          ? ({
              pattern: "GRID",
              sectionSize: s.sectionSizePx ?? 8,
              visible: true,
              color: { r: 1, g: 0, b: 0, a: 0.1 },
            } as GridLayoutGrid)
          : ({
              pattern: s.pattern,
              alignment: s.alignment ?? "STRETCH",
              gutterSize: s.gutterPx ?? 20,
              count: s.count ?? 12,
              offset: s.marginPx ?? 0,
              sectionSize: s.sectionSizePx,
              visible: true,
              color: { r: 1, g: 0, b: 0, a: 0.1 },
            } as unknown as RowsColsLayoutGrid);
      style.layoutGrids = [grid];
    } catch (e) {
      warnings.push(`grid style "${s.name}": ${errText(e)}`);
    }
    ids[s.name] = style.id;
  }
  return ids;
}

/* ------------------------------------------------------------------ */
/* Dry-run report (no mutation)                                        */
/* ------------------------------------------------------------------ */

function dryRunResult(plan: FoundationsPlan): FoundationsResult {
  return {
    collections: plan.collections.map((c) => ({
      name: c.name,
      id: "",
      modeIds: {},
      variableIds: {},
    })),
    textStyleIds: {},
    effectStyleIds: {},
    gridStyleIds: {},
    warnings: [
      `dry run: would create ${plan.collections.length} collection(s), ` +
        `${plan.collections.reduce((n, c) => n + c.variables.length, 0)} variable(s), ` +
        `${plan.textStyles.length} text / ${plan.effectStyles.length} effect / ` +
        `${plan.gridStyles.length} grid style(s)`,
    ],
  };
}

/* ------------------------------------------------------------------ */
/* Entry point                                                         */
/* ------------------------------------------------------------------ */

export async function applyFoundations(
  plan: FoundationsPlan,
  dryRun?: boolean,
): Promise<FoundationsResult> {
  if (dryRun) return dryRunResult(plan);

  const warnings: string[] = [];

  // Pass 1: create every collection + variable (no values yet).
  const built: BuiltCollection[] = [];
  const nameIndex = new Map<string, Variable>(); // global name → variable (for aliases + bindings)
  for (const spec of plan.collections) {
    const bc = await ensureCollection(spec, warnings);
    built.push(bc);
    for (const [name, v] of bc.variables) nameIndex.set(name, v);
  }

  // Pass 2: set values now that aliases can resolve.
  for (const bc of built) setVariableValues(bc, nameIndex, warnings);

  // Styles.
  const textStyleIds = await ensureTextStyles(plan.textStyles, nameIndex, warnings);
  const effectStyleIds = await ensureEffectStyles(plan.effectStyles, warnings);
  const gridStyleIds = await ensureGridStyles(plan.gridStyles, warnings);

  return {
    collections: built.map((bc) => {
      const variableIds: Record<string, string> = {};
      for (const [name, v] of bc.variables) variableIds[name] = v.id;
      return {
        name: bc.spec.name,
        id: bc.collection.id,
        modeIds: bc.modeIds,
        variableIds,
      };
    }),
    textStyleIds,
    effectStyleIds,
    gridStyleIds,
    warnings,
  };
}
