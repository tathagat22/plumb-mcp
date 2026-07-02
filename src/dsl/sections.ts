/**
 * Section registry — Layer-1 semantic sugar → Layer-2 Blocks.
 *
 * A Section (nav / hero / card-grid / features / form / cta / footer / content /
 * custom) is opinionated sugar: it expands into a plain Stack of primitive
 * Blocks, which blocks.ts then lowers to PDS. Keeping expansion here (rather
 * than in the lowerer) means the semantic layout decisions — "a hero is a
 * centred column with an eyebrow, headline, sub, and an action row" — live in
 * one legible place, and new roles can be registered without touching blocks.ts.
 *
 * `registerSection(role, lowerer)` lets callers add or override a role.
 */

import type {
  Block,
  Brand,
  Button,
  Card,
  CardGridSection,
  ContentSection,
  CtaSection,
  CustomSection,
  FeaturesSection,
  FooterSection,
  FormSection,
  HeroSection,
  NavSection,
  PadSpec,
  Section,
  Space,
  Stack,
  Text,
  TextValue,
} from "./schema";

export interface SectionCtx {
  brand: Brand;
}

/** A section lowerer expands a Section into a single container Block. */
export type SectionLowerer<S extends Section = Section> = (section: S, ctx: SectionCtx) => Block;

const registry = new Map<string, SectionLowerer>();

/** Register (or override) the lowerer for a section role. */
export function registerSection<S extends Section>(role: S["role"], lowerer: SectionLowerer<S>): void {
  registry.set(role, lowerer as SectionLowerer);
}

/** Expand any Section into a Block via its registered lowerer. */
export function lowerSection(section: Section, ctx: SectionCtx): Block {
  const lowerer = registry.get(section.role);
  if (!lowerer) throw new Error(`lowerSection: no lowerer registered for role "${section.role}"`);
  return lowerer(section, ctx);
}

/* ------------------------------------------------------------------------ */
/* Shared helpers                                                             */
/* ------------------------------------------------------------------------ */

/** Zero out the horizontal component of a PadSpec, keeping vertical intact —
 *  used for `bleed` sections whose content should run edge-to-edge. */
function zeroHorizontal(pad: PadSpec): [Space, Space, Space, Space] {
  if (!Array.isArray(pad)) return [pad, 0, pad, 0];
  if (pad.length === 2) return [pad[0], 0, pad[0], 0];
  return [pad[0], 0, pad[2], 0];
}

/** The outer section frame: full-width band + centred max-width content column.
 *  `bleed: true` skips the maxWidth clamp and zeroes horizontal padding so
 *  content (e.g. a full-bleed image or color band) runs edge-to-edge. */
function band(section: Section, content: Block[], contentDir: "row" | "col" = "col"): Stack {
  const bleed = !!section.bleed;
  // Flagship sections breathe — 96px vertical is the elite default (Vercel/
  // Stripe marketing run 96–128). Cramped 48–64 air is a core "AI slop" tell.
  const basePad = section.pad ?? [96, 24];
  const pad = bleed ? zeroHorizontal(basePad) : basePad;
  const inner: Stack = {
    type: "stack",
    name: "container",
    dir: contentDir,
    gap: section.gap ?? 24,
    align: section.align,
    justify: section.justify,
    w: bleed ? "fill" : section.maxWidth ? section.maxWidth : "fill",
    self: "center",
    children: content,
  };
  return {
    type: "stack",
    id: section.id,
    name: section.role,
    dir: "col",
    align: "center",
    w: "fill",
    pad,
    ...(section.bg !== undefined ? { bg: section.bg } : {}),
    children: [inner],
  };
}

function heading(text: TextValue, style = "h2", textAlign?: "left" | "center" | "right"): Text {
  // Fill the column so a long headline WRAPS within it instead of hugging to a
  // single line — a hug headline overflows its column and clips (the hero H1
  // truncating mid-word) or collides with the next column (the footer brand
  // overlapping the link columns). Alignment follows the surrounding column
  // when the caller passes it (centred hero / cta).
  return { type: "text", text, style, w: "fill", ...(textAlign ? { textAlign } : {}) };
}

function paragraph(text: string, color = "@muted", textAlign?: "left" | "center" | "right"): Text {
  // Fill the container so body copy wraps within it (and grows height) instead
  // of hugging into one overflowing line.
  return { type: "text", text, style: "body", color, w: "fill", ...(textAlign ? { textAlign } : {}) };
}

function actionRow(actions: Button[] | undefined): Stack | undefined {
  if (!actions?.length) return undefined;
  return {
    type: "stack",
    name: "actions",
    dir: "row",
    gap: 12,
    align: "center",
    children: actions as unknown as Block[],
  };
}

function cardBlock(card: Card): Stack {
  const children: Block[] = [];
  if (card.image) {
    children.push({ type: "image", src: card.image, w: "fill", h: 180, radius: 8 });
  }
  if (card.icon) {
    // A tinted circular chip makes the icon a deliberate focal accent rather
    // than a tiny mark lost dark-on-dark. Icon takes the primary/accent colour.
    children.push({
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
      children: [{ type: "icon", name: card.icon, size: 30, color: "@primary" }],
    });
  }
  children.push(heading(card.title, "h3"));
  if (card.body) children.push(paragraph(card.body));
  if (card.action) children.push(card.action as unknown as Block);
  return {
    type: "stack",
    name: "card",
    dir: "col",
    gap: 12,
    pad: 24,
    w: "fill",
    bg: "@surface",
    // Hairline border + a soft ambient shadow give the card real elevation
    // (both drop silently if the brand lacks a `border` colour / `shadow` scale).
    border: { color: "@border", width: 1 },
    shadow: "lg",
    radius: 12,
    children,
  };
}

/** Chunk cards into rows of `columns` for a wrapped grid. Short trailing rows are
 *  padded with invisible grow spacers so every card keeps the same column width.
 *  `columnRatios` (e.g. `[2,1]`) gives columns unequal grow weights instead of
 *  the forced-equal default; it cycles by column index within each row. */
function grid(cards: Card[], columns: number, columnRatios?: number[]): Stack {
  const ratioFor = (col: number): number => {
    if (!columnRatios?.length) return 1;
    const r = columnRatios[col % columnRatios.length];
    return r && r > 0 ? r : 1;
  };
  const rows: Block[] = [];
  for (let i = 0; i < cards.length; i += columns) {
    const rowCards: Block[] = cards
      .slice(i, i + columns)
      .map((c, col) => ({ ...cardBlock(c), grow: ratioFor(col) }));
    for (let pad = rowCards.length; pad < columns; pad += 1) {
      rowCards.push({ type: "stack", name: "col-spacer", dir: "col", grow: ratioFor(pad), children: [] });
    }
    rows.push({
      type: "stack",
      name: "row",
      dir: "row",
      gap: 24,
      w: "fill",
      children: rowCards,
    });
  }
  return { type: "stack", name: "grid", dir: "col", gap: 24, w: "fill", children: rows };
}

/* ------------------------------------------------------------------------ */
/* Built-in lowerers                                                          */
/* ------------------------------------------------------------------------ */

registerSection<NavSection>("nav", (s) => {
  const brandChildren: Block[] = [];
  if (s.brand?.logo) brandChildren.push({ type: "image", src: s.brand.logo, w: 120, h: 32 });
  if (s.brand?.text) brandChildren.push(heading(s.brand.text, "h3"));
  const brandStack: Stack = {
    type: "stack",
    name: "brand",
    dir: "row",
    gap: 8,
    align: "center",
    children: brandChildren,
  };
  const links: Stack = {
    type: "stack",
    name: "links",
    dir: "row",
    gap: 24,
    align: "center",
    children: s.links.map((l) => ({
      type: "text",
      text: l.label,
      style: "body",
      ...(l.href ? { interactions: [{ on: "click", url: l.href }] } : {}),
    })),
  };
  const actions = actionRow(s.actions);
  const inner: Stack = {
    type: "stack",
    name: "container",
    dir: "row",
    justify: "between",
    align: "center",
    w: s.maxWidth ? s.maxWidth : "fill",
    self: "center",
    gap: 24,
    children: actions ? [brandStack, links, actions] : [brandStack, links],
  };
  return {
    type: "stack",
    id: s.id,
    name: "nav",
    dir: "col",
    align: "center",
    w: "fill",
    pad: s.pad ?? [16, 24],
    ...(s.bg !== undefined ? { bg: s.bg } : {}),
    children: [inner],
  };
});

registerSection<HeroSection>("hero", (s) => {
  const layout = s.layout ?? "center";
  const centered = layout === "center";
  const textAlign = centered ? "center" : undefined;

  const copy: Block[] = [];
  if (s.eyebrow)
    copy.push({ type: "text", text: s.eyebrow, style: "label", color: "@primary", ...(textAlign ? { textAlign } : {}) });
  copy.push(heading(s.headline, "display", textAlign));
  if (s.sub) copy.push(paragraph(s.sub, "@muted", textAlign));
  const actions = actionRow(s.actions);
  if (actions) copy.push(actions);

  const copyStack: Stack = {
    type: "stack",
    name: "copy",
    dir: "col",
    gap: 20,
    grow: 1,
    align: centered ? "center" : "start",
    children: copy,
  };

  if (centered) {
    return band(s, [copyStack]);
  }
  const media: Block = s.media ?? { type: "image", src: { query: "hero", kind: "illustration" }, w: "fill", h: 400 };
  const mediaStack: Stack = { type: "stack", name: "media", dir: "col", grow: 1, w: "fill", children: [media] };
  const row = layout === "split-right" ? [copyStack, mediaStack] : [mediaStack, copyStack];
  return band(s, row, "row");
});

registerSection<CardGridSection>("card-grid", (s) => {
  const content: Block[] = [];
  if (s.heading) content.push(heading(s.heading));
  content.push(grid(s.cards, s.columns ?? 3, s.columnRatios));
  return band(s, content);
});

registerSection<FeaturesSection>("features", (s) => {
  const content: Block[] = [];
  if (s.heading) content.push(heading(s.heading));
  if (s.layout === "alternating") {
    s.features.forEach((f, i) => {
      const text: Stack = {
        type: "stack",
        name: "feature-copy",
        dir: "col",
        gap: 12,
        grow: 1,
        children: [heading(f.title, "h3"), ...(f.body ? [paragraph(f.body)] : [])],
      };
      const media: Block = f.image
        ? { type: "image", src: f.image, w: "fill", h: 280, radius: 12, grow: 1 }
        : { type: "icon", name: f.icon ?? "star", size: 64, color: "@primary" };
      const row: Block[] = i % 2 === 0 ? [text, media] : [media, text];
      content.push({ type: "stack", name: "feature", dir: "row", gap: 48, align: "center", w: "fill", children: row });
    });
  } else {
    content.push(grid(s.features, Math.min(s.features.length, 3) || 1, s.columnRatios));
  }
  return band(s, content);
});

registerSection<FormSection>("form", (s) => {
  const content: Block[] = [];
  if (s.heading) content.push(heading(s.heading));
  for (const f of s.fields) content.push({ ...f });
  content.push(s.submit as unknown as Block);
  const form = band(s, content);
  // Narrow the form column for readability.
  const inner = form.children[0] as Stack;
  inner.w = s.maxWidth ?? 480;
  return form;
});

registerSection<CtaSection>("cta", (s) => {
  // A CTA sitting on a filled band (e.g. bg:@primary) must use on-primary copy —
  // the default @muted is dark and vanishes on the band (the "invisible CTA
  // subtitle" the director flagged). Off a band, @muted (now AA-safe) is fine.
  const subColor = s.bg !== undefined ? "@onPrimary" : "@muted";
  const content: Block[] = [heading(s.headline, "h1", "center")];
  if (s.sub) content.push(paragraph(s.sub, subColor, "center"));
  const actions = actionRow(s.actions);
  if (actions) content.push(actions);
  const cta = band(s, content);
  const inner = cta.children[0] as Stack;
  inner.align = "center";
  return cta;
});

registerSection<FooterSection>("footer", (s) => {
  const cols: Block[] = (s.columns ?? []).map((col) => ({
    type: "stack",
    name: "footer-col",
    dir: "col",
    gap: 10,
    grow: 1,
    children: [
      { type: "text", text: col.title, style: "label", color: "@muted" } as Text,
      ...col.links.map((l) => ({
        type: "text",
        text: l.label,
        style: "body",
        ...(l.href ? { interactions: [{ on: "click", url: l.href }] } : {}),
      })) as Block[],
    ],
  }));

  const brandChildren: Block[] = [];
  if (s.brand?.logo) brandChildren.push({ type: "image", src: s.brand.logo, w: 120, h: 32 });
  if (s.brand?.text) brandChildren.push(heading(s.brand.text, "h3"));

  const topRow: Stack = {
    type: "stack",
    name: "footer-top",
    dir: "row",
    gap: 48,
    justify: "between",
    w: "fill",
    children: [
      // Bound the brand column so a long wordmark wraps within it instead of
      // running into the first link column.
      { type: "stack", name: "footer-brand", dir: "col", gap: 8, w: 260, children: brandChildren },
      ...cols,
    ],
  };
  const content: Block[] = [topRow];
  if (s.legal) content.push(paragraph(s.legal, "@muted"));
  return band(s, content);
});

registerSection<ContentSection>("content", (s) => band(s, s.children));

registerSection<CustomSection>("custom", (s) => {
  // Custom sections carry an arbitrary root block; wrap it in the band frame.
  return band(s, [s.root]);
});
