/**
 * Brand board builder — turns a discovered brief (references + their captured
 * screenshots + a synthesized palette) into a single ready-to-apply DesignDoc,
 * plus the AssetResolver + staged-asset map that make the reference screenshots
 * render as real Figma image fills.
 *
 * The screenshots are staged EXACTLY like design.ts's makeSourcingResolver: each
 * capture's PNG bytes go through stageInboundAsset → a key; the key is recorded
 * in `assets` (so lowerToEmitPlan ships the bytes) and returned as the
 * ResolvedAsset.assetId, which becomes PdsNode.assetId and, ultimately, the
 * `GET /asset/<key>` the plugin fetches. The resolver matches an AssetSpec back
 * to its screenshot by URL (the query the board's image blocks carry).
 */

import type { LowerAssetInfo } from "../emit/plan";
import type {
  AssetResolver,
  AssetSpec,
  Block,
  BrandColors as DslBrandColors,
  DesignDoc,
  ResolvedAsset,
  Stack,
  Text,
  TypeScale,
} from "../dsl/schema";
import { stageInboundAsset } from "../bridge/server";
import type { FoundationsPlan, TextStyleSpec, VarCollectionSpec } from "../bridge/protocol";
import type { Reference } from "./references";
import type { Capture } from "./capture";
import type { BrandColors } from "./palette";

export interface BrandBoardInput {
  brief: { name?: string; description?: string };
  references: Reference[];
  captures: Capture[];
  brand: BrandColors;
}

export interface BrandBoard {
  doc: DesignDoc;
  resolver: AssetResolver;
  assets: Record<string, LowerAssetInfo>;
  /** Real, reusable Figma tokens for the same palette + type scale — apply via
   *  bridge/server's requestApplyFoundations (blueprint §3, apply-foundations),
   *  ahead of requestApplyDesign. Not just the visual swatch rectangles below. */
  foundations: FoundationsPlan;
}

/** Swatch roles shown in the palette strip, in reading order. */
const SWATCH_ROLES = ["bg", "surface", "text", "muted", "primary", "border"] as const;

/**
 * Turn a brand palette + type scale into a Figma-native {@link FoundationsPlan}:
 * one "Brand" Variable collection (a COLOR variable per palette role) plus a
 * named text style per type-scale entry. This is the reusable-token path —
 * the plugin's `applyFoundations` (figma-plugin/foundations.ts) materialises
 * it as real Figma Variables + text styles, distinct from the palette strip's
 * static colour rectangles.
 */
export function buildBrandFoundations(
  brand: BrandColors,
  type: TypeScale,
  fonts: { heading?: string; body?: string; mono?: string },
): FoundationsPlan {
  const collection: VarCollectionSpec = {
    name: "Brand",
    modes: ["Value"],
    variables: (Object.keys(brand) as (keyof BrandColors)[]).map((role) => ({
      name: `color/${role}`,
      type: "COLOR",
      values: { Value: { hex: brand[role] } },
    })),
  };

  const resolveFont = (font?: string): string => {
    if (font === "heading") return fonts.heading ?? "Inter";
    if (font === "body") return fonts.body ?? "Inter";
    if (font === "mono") return fonts.mono ?? "Inter";
    return font ?? fonts.body ?? "Inter";
  };

  const textStyles: TextStyleSpec[] = Object.entries(type)
    .filter((entry): entry is [string, NonNullable<TypeScale[string]>] => !!entry[1])
    .map(([name, style]) => ({
      name: `Brand/${name.charAt(0).toUpperCase()}${name.slice(1)}`,
      family: resolveFont(style.font),
      weight: style.weight ?? 400,
      sizePx: style.size,
      lineHeightPercent: style.line ? Math.round(style.line * 100) : undefined,
      letterSpacingPx: style.tracking,
      textCase: style.transform === "upper" ? "UPPER" : "ORIGINAL",
    }));

  return { collections: [collection], textStyles, effectStyles: [], gridStyles: [] };
}

export function buildBrandBoard(input: BrandBoardInput): BrandBoard {
  const { brief, references, captures, brand } = input;

  // 1. Stage every capture's PNG bytes and index the staged key by source URL.
  const assets: Record<string, LowerAssetInfo> = {};
  const keyByUrl = new Map<string, { key: string; w: number; h: number }>();
  for (const cap of captures) {
    const key = stageInboundAsset(cap.png, "png");
    assets[key] = { ext: "png", kind: "image", w: cap.width, h: cap.height };
    keyByUrl.set(cap.url, { key, w: cap.width, h: cap.height });
  }

  // 2. Resolver: a URL query resolves to its staged screenshot; anything else
  //    degrades to metadata-only (never throws, matching the asset contract).
  const resolver: AssetResolver = {
    async resolve(spec: AssetSpec): Promise<ResolvedAsset> {
      const hit = keyByUrl.get(spec.query);
      if (hit) {
        return {
          assetId: hit.key,
          kind: "photo",
          w: hit.w,
          h: hit.h,
          scaleMode: "fill",
        };
      }
      return { kind: spec.kind ?? "photo" };
    },
  };

  // 3. The document.
  const referenceRow: Stack = {
    type: "stack",
    name: "references",
    dir: "row",
    gap: 20,
    w: "fill",
    children: references.map(
      (ref): Stack => ({
        type: "stack",
        name: "reference-card",
        dir: "col",
        grow: 1,
        gap: 10,
        children: [
          {
            type: "image",
            src: { query: ref.url, kind: "photo" },
            w: "fill",
            h: 230,
            radius: 10,
            fit: "crop",
          },
          { type: "text", text: ref.name, style: "h3" },
          { type: "text", text: ref.why, style: "small", color: "@muted", w: "fill" },
        ],
      }),
    ),
  };

  const swatchRow: Stack = {
    type: "stack",
    name: "swatches",
    dir: "row",
    gap: 16,
    w: "fill",
    children: SWATCH_ROLES.map((role): Stack => {
      const hex = brand[role];
      return {
        type: "stack",
        name: `swatch-${role}`,
        dir: "col",
        grow: 1,
        gap: 8,
        children: [
          {
            type: "stack",
            name: "chip",
            dir: "col",
            w: "fill",
            h: 96,
            bg: hex,
            radius: 10,
            border: { color: "@border", width: 1 },
            children: [],
          },
          { type: "text", text: role, style: "label" },
          { type: "text", text: hex, style: "small", color: "@muted" },
        ],
      };
    }),
  };

  const typographySamples: Block[] = [
    { type: "text", text: "Display 64", style: "display" } as Text,
    { type: "text", text: "Heading 40", style: "h1" } as Text,
    {
      type: "text",
      text:
        "Body copy sets the reading rhythm for the whole system — comfortable size, " +
        "generous line-height, and a muted tone that stays legible without competing " +
        "with headings. This paragraph shows the body style wrapping within its column.",
      style: "body",
      color: "@muted",
      w: "fill",
    } as Text,
  ];

  const fonts = { heading: "Inter", body: "Inter" };
  const type: TypeScale = {
    display: { size: 64, weight: 600, line: 1.05, font: "heading" },
    h1: { size: 40, weight: 600, line: 1.1, font: "heading" },
    h2: { size: 28, weight: 600, line: 1.2, font: "heading" },
    h3: { size: 20, weight: 600, line: 1.3, font: "heading" },
    body: { size: 16, weight: 400, line: 1.6, font: "body" },
    small: { size: 13, weight: 400, line: 1.5, font: "body" },
    label: { size: 12, weight: 600, line: 1.2, font: "body", transform: "upper" },
  };

  const doc: DesignDoc = {
    version: "1",
    meta: {
      name: brief.name ?? "Brand board",
      description: brief.description,
    },
    brand: {
      fonts,
      // palette.BrandColors is a fully-concrete role map; the DSL's BrandColors
      // carries an index signature, so bridge it explicitly.
      colors: brand as unknown as DslBrandColors,
      type,
      spacing: { xs: 4, sm: 8, md: 16, lg: 24, xl: 48 },
      radius: { sm: 8, md: 12, lg: 16, full: "full" },
    },
    pages: [
      {
        name: "Brand",
        width: 1440,
        bg: "@bg",
        sections: [
          {
            role: "content",
            children: [{ type: "text", text: "References", style: "h2" }, referenceRow],
          },
          {
            role: "content",
            children: [{ type: "text", text: "Brand colours", style: "h2" }, swatchRow],
          },
          {
            role: "content",
            children: [{ type: "text", text: "Typography", style: "h2" }, ...typographySamples],
          },
        ],
      },
    ],
  };

  const foundations = buildBrandFoundations(brand, type, fonts);

  return { doc, resolver, assets, foundations };
}
