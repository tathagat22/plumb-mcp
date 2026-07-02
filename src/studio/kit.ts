/**
 * Component kit — the reusable library the "components" step of the studio
 * flow builds onto its own named Figma page, then puts on show.
 *
 * These are REAL, slot-free Components: each `body` is a single Block whose
 * text/icon fields carry `"@prop.<name>"` placeholders, so buildComponentMaster
 * (src/dsl/components.ts) turns each into an actual Figma component master
 * (build-once / instantiate-many). Because emit does NOT yet wire Figma
 * componentPropertyDefinitions, a slot-free instance renders the master's
 * DEFAULT content — so every master is authored to look good at its defaults,
 * and the showcase drops exactly ONE default instance of each. This page is
 * the visible, reusable kit; composed product pages vary content through the
 * normal Section system.
 *
 * Colour @roles (@surface/@border/@primary/@onPrimary/@muted/@elevated/@text)
 * resolve against the brand foundations already applied to the file, so the
 * kit inherits whatever palette the Brand step synthesised.
 */

import type { Block, Component, Icon, Section, Stack, Text } from "../dsl/schema";

export interface ComponentKit {
  /** Real slot-free masters, registered on DesignDoc.components. */
  components: Component[];
  /** The showcase page body: one tidy "component sheet" Section. */
  showcase: Section[];
}

/* ------------------------------------------------------------------------ */
/* Component masters                                                          */
/* ------------------------------------------------------------------------ */

/** A primary pill — the shared look behind Button and the PricingCard CTA. */
function primaryPill(labelPlaceholder: string): Stack {
  return {
    type: "stack",
    name: "pill",
    dir: "row",
    align: "center",
    justify: "center",
    pad: [12, 20],
    radius: "full",
    bg: "@primary",
    children: [{ type: "text", text: labelPlaceholder, style: "label", color: "@onPrimary" }],
  };
}

function buttonComponent(): Component {
  return {
    name: "Button",
    props: [{ name: "label", type: "text", default: "Get started" }],
    body: primaryPill("@prop.label"),
  };
}

function featureCardComponent(): Component {
  // Mirrors the cardBlock look in src/dsl/sections.ts: tinted 64px icon chip,
  // an h3 title, and muted body copy in an elevated, hairline-bordered card.
  const iconChip: Stack = {
    type: "stack",
    name: "icon-chip",
    dir: "col",
    align: "center",
    justify: "center",
    w: 64,
    h: 64,
    bg: "@elevated",
    border: { color: "@border", width: 1 },
    radius: "full",
    children: [{ type: "icon", name: "@prop.icon", size: 30, color: "@primary" } as Icon],
  };
  const body: Stack = {
    type: "stack",
    name: "FeatureCard",
    dir: "col",
    gap: 12,
    pad: 24,
    w: "fill",
    bg: "@surface",
    border: { color: "@border", width: 1 },
    shadow: "lg",
    radius: 12,
    children: [
      iconChip,
      { type: "text", text: "@prop.title", style: "h3", w: "fill" } as Text,
      { type: "text", text: "@prop.body", style: "body", color: "@muted", w: "fill" } as Text,
    ],
  };
  return {
    name: "FeatureCard",
    props: [
      { name: "icon", type: "text", default: "lucide:sparkles" },
      { name: "title", type: "text", default: "Feature" },
      { name: "body", type: "text", default: "A concise description of the capability." },
    ],
    body,
  };
}

function statCardComponent(): Component {
  const body: Stack = {
    type: "stack",
    name: "StatCard",
    dir: "col",
    gap: 4,
    pad: 24,
    w: "fill",
    bg: "@surface",
    border: { color: "@border", width: 1 },
    radius: 12,
    children: [
      { type: "text", text: "@prop.value", style: "h1", w: "fill" } as Text,
      { type: "text", text: "@prop.label", style: "small", color: "@muted", w: "fill" } as Text,
    ],
  };
  return {
    name: "StatCard",
    props: [
      { name: "value", type: "text", default: "128k" },
      { name: "label", type: "text", default: "Monthly active" },
    ],
    body,
  };
}

function pricingCardComponent(): Component {
  const body: Stack = {
    type: "stack",
    name: "PricingCard",
    dir: "col",
    gap: 12,
    pad: 24,
    w: "fill",
    bg: "@surface",
    border: { color: "@border", width: 1 },
    shadow: "lg",
    radius: 16,
    children: [
      { type: "text", text: "@prop.plan", style: "h3" } as Text,
      { type: "text", text: "@prop.price", style: "display", w: "fill" } as Text,
      primaryPill("@prop.cta"),
    ],
  };
  return {
    name: "PricingCard",
    props: [
      { name: "plan", type: "text", default: "Pro" },
      { name: "price", type: "text", default: "$29/mo" },
      { name: "cta", type: "text", default: "Choose Pro" },
    ],
    body,
  };
}

/* ------------------------------------------------------------------------ */
/* Showcase — the component sheet                                             */
/* ------------------------------------------------------------------------ */

/** One labelled cell: a muted caption above a single default Instance. */
function showcaseCell(name: string): Stack {
  return {
    type: "stack",
    name: `cell-${name}`,
    dir: "col",
    gap: 10,
    grow: 1,
    children: [
      { type: "text", text: name, style: "label", color: "@muted" } as Text,
      { type: "instance", component: name, w: "fill" },
    ],
  };
}

/** Wrap cells into rows of `columns`, padding short rows with grow spacers so
 *  every cell keeps a consistent column width — a tidy sheet, not a ragged mob. */
function sheet(names: string[], columns: number): Stack {
  const rows: Block[] = [];
  for (let i = 0; i < names.length; i += columns) {
    const cells: Block[] = names.slice(i, i + columns).map(showcaseCell);
    for (let pad = cells.length; pad < columns; pad += 1) {
      cells.push({ type: "stack", name: "col-spacer", dir: "col", grow: 1, children: [] });
    }
    rows.push({ type: "stack", name: "row", dir: "row", gap: 24, align: "start", w: "fill", children: cells });
  }
  return { type: "stack", name: "sheet", dir: "col", gap: 24, w: "fill", children: rows };
}

/* ------------------------------------------------------------------------ */
/* Public builder                                                             */
/* ------------------------------------------------------------------------ */

export function buildComponentKit(): ComponentKit {
  const components: Component[] = [
    buttonComponent(),
    featureCardComponent(),
    statCardComponent(),
    pricingCardComponent(),
  ];
  const names = components.map((c) => c.name);

  const showcase: Section[] = [
    {
      role: "content",
      children: [
        { type: "text", text: "The component library", style: "h2", w: "fill" } as Text,
        {
          type: "text",
          text: "Reusable masters synthesised from the brand — instantiate anywhere.",
          style: "body",
          color: "@muted",
          w: "fill",
        } as Text,
        sheet(names, 2),
      ],
    },
  ];

  return { components, showcase };
}
