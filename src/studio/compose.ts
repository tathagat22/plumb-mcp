/**
 * Per-page composition for the transparent step-by-step studio.
 *
 * Where buildStudioDoc (src/tools/studio.ts) authors ONE landing page in a
 * single silent pass, this module authors the SECTION list for a single
 * product page of a given `kind` — so the step-by-step flow can build (and let
 * the user review) each page in sequence: a landing page, a features page, a
 * pricing page, a dashboard. Every kind reuses the proven Section system
 * (nav / hero / features / card-grid / cta / content / footer) so the pages
 * look designed and the content varies by kind rather than by template.
 *
 * Brand-free authoring, exactly like buildStudioDoc: the caller owns the
 * DesignDoc.brand and the AssetResolver — this module only emits Sections and
 * references reference imagery through `ctx.refImageQuery(ref)` (the same
 * query the caller wired its resolver against, i.e. the reference URL).
 *
 * If the caller has already built a real component library, pass its master
 * names in `ctx.kitComponentNames` and each composed page appends a compact
 * "Built from the component library" strip that instantiates one of each — so
 * the composed page visibly consumes the real kit.
 */

import type { Block, Card, Section, Text } from "../dsl/schema";
import type { Reference } from "../brand/references";

export type PageKind = "landing" | "features" | "pricing" | "dashboard";

export interface ComposeCtx {
  brief: string;
  name: string;
  refs: Reference[];
  /** url -> the AssetSpec.query to use for that reference's staged image (== the url). */
  refImageQuery: (ref: Reference) => string; // caller wires the resolver; you just build AssetSpec { query: refImageQuery(ref), kind:"photo" }
  kitComponentNames: string[]; // names available to instantiate (may be empty)
}

/* ------------------------------------------------------------------------ */
/* Shared section authoring — nav + footer bookend every page, mirroring     */
/* buildStudioDoc's nav/footer (brand name = ctx.name).                       */
/* ------------------------------------------------------------------------ */

function navSection(name: string): Section {
  return {
    role: "nav",
    sticky: true,
    brand: { text: name },
    links: [
      { label: "Product", href: "#product" },
      { label: "Features", href: "#features" },
      { label: "Pricing", href: "#pricing" },
      { label: "About", href: "#about" },
    ],
    actions: [
      { type: "button", label: "Sign in", variant: "ghost" },
      { type: "button", label: "Get started", variant: "primary", icon: "lucide:arrow-right", iconPos: "right" },
    ],
  };
}

function footerSection(name: string): Section {
  return {
    role: "footer",
    bg: "@surface",
    brand: { text: name },
    columns: [
      { title: "Product", links: [{ label: "Features" }, { label: "Pricing" }, { label: "Dashboard" }] },
      { title: "Company", links: [{ label: "About" }, { label: "Contact" }] },
    ],
    legal: `© ${new Date().getFullYear()} ${name}. Built with Plumb.`,
  };
}

/** Strip a leading article + trailing punctuation, matching studio.ts's bareBrief. */
function bareBrief(brief: string): string {
  return brief.trim().replace(/^(a|an|the)\s+/i, "").replace(/[.!?]+$/, "");
}

/** A reference's staged image, wired through the caller's resolver query. */
function refImage(ctx: ComposeCtx, ref: Reference): { query: string; kind: "photo" } {
  return { query: ctx.refImageQuery(ref), kind: "photo" };
}

/**
 * The "Built from the component library" strip — a compact content section
 * that drops ONE real Instance of each kit component in a row, so the composed
 * page visibly instantiates the live library. Returns undefined when the kit
 * is empty (the library step hasn't run yet).
 */
function kitStrip(ctx: ComposeCtx): Section | undefined {
  if (ctx.kitComponentNames.length === 0) return undefined;
  const heading: Text = {
    type: "text",
    text: "Built from the component library",
    style: "h2",
    w: "fill",
  };
  const row: Block = {
    type: "stack",
    name: "kit-strip",
    dir: "row",
    gap: 24,
    wrap: true,
    align: "start",
    w: "fill",
    children: ctx.kitComponentNames.map((component) => ({
      type: "instance",
      component,
    })),
  };
  return { role: "content", children: [heading, row] };
}

/* ------------------------------------------------------------------------ */
/* Per-kind section builders                                                  */
/* ------------------------------------------------------------------------ */

/** Landing — the buildStudioDoc shape: hero + features + reference gallery + cta. */
function landing(ctx: ComposeCtx): Section[] {
  const { name, refs } = ctx;
  const bare = bareBrief(ctx.brief);
  const heroRef = refs[0] as Reference;
  const headline = bare ? bare.charAt(0).toUpperCase() + bare.slice(1) : name;

  const features: Card[] = [
    {
      icon: "lucide:sparkles",
      title: "Crafted for the brief",
      body: `Every section is composed to match the tone of "${bare || ctx.brief}" — not filled into a generic template.`,
    },
    {
      icon: "lucide:palette",
      title: "One coherent palette",
      body: `Colours are extracted live from ${refs.length} reference site(s) and synthesized into a single semantic system.`,
    },
    {
      icon: "lucide:layout-grid",
      title: "Built end to end",
      body: "Nav, hero, features, gallery, and a call to action — a full page composed to the brief.",
    },
  ];

  const galleryCards: Card[] = Array.from({ length: 3 }, (_, i) => {
    const ref = refs[i % refs.length] as Reference;
    return { image: refImage(ctx, ref), title: ref.name, body: ref.why };
  });

  return [
    navSection(name),
    {
      role: "hero",
      layout: "split-right",
      maxWidth: 1200,
      eyebrow: "INTRODUCING",
      headline,
      sub:
        `A complete, on-brand landing page for ${bare || ctx.brief} — composed ` +
        `from a single brief and ${refs.length} live reference site(s).`,
      actions: [
        { type: "button", label: "Get started", variant: "primary", size: "lg" },
        { type: "button", label: "See how it works", variant: "outline", size: "lg" },
      ],
      media: {
        type: "image",
        src: { query: ctx.refImageQuery(heroRef), kind: "photo", role: "hero" },
        w: "fill",
        h: 420,
        radius: "lg",
      },
    },
    {
      role: "features",
      heading: "Everything you need",
      bg: "@surface",
      layout: "row",
      features,
    },
    {
      role: "card-grid",
      heading: "Inspired by the best",
      columns: 3,
      cards: galleryCards,
    },
    {
      role: "cta",
      bg: "@primary",
      theme: "dark",
      headline: `Start with ${name}`,
      sub: "Free to explore — composed and ready to ship.",
      actions: [{ type: "button", label: "Get started", variant: "secondary", size: "lg" }],
    },
    footerSection(name),
  ];
}

/** Features — a centred hero + a 6-card features grid + cta. */
function features(ctx: ComposeCtx): Section[] {
  const { name } = ctx;
  const bare = bareBrief(ctx.brief);

  const cards: Card[] = [
    { icon: "lucide:sparkles", title: "Composed, not templated", body: "Each section is authored to the brief so the page reads as a considered whole." },
    { icon: "lucide:palette", title: "One coherent palette", body: "A single semantic colour system, synthesized from live reference sites." },
    { icon: "lucide:layout-grid", title: "Real sections", body: "Nav, hero, features, gallery, cta and footer — the same primitives across every page." },
    { icon: "lucide:gauge", title: "Fast to review", body: "Built page by page onto named Figma pages, so you can review between steps." },
    { icon: "lucide:component", title: "A real component library", body: "Reusable Figma component masters you can instantiate across the design." },
    { icon: "lucide:wand-2", title: "On brand throughout", body: `Type, spacing and colour stay consistent for "${bare || ctx.brief}".` },
  ];

  return [
    navSection(name),
    {
      role: "hero",
      layout: "center",
      maxWidth: 900,
      eyebrow: "FEATURES",
      headline: "Features",
      sub: `Everything ${name} composes for you, on brand and in sequence.`,
    },
    {
      role: "features",
      heading: "Built for the whole product",
      bg: "@surface",
      layout: "row",
      features: cards,
    },
    {
      role: "cta",
      bg: "@primary",
      theme: "dark",
      headline: `Design the rest with ${name}`,
      sub: "Every page composed to the same system.",
      actions: [{ type: "button", label: "Get started", variant: "secondary", size: "lg" }],
    },
    footerSection(name),
  ];
}

/** Pricing — a centred hero + a 3-tier card grid (title=plan, body=price+blurb,
 *  a primary action button) + cta. */
function pricing(ctx: ComposeCtx): Section[] {
  const { name } = ctx;

  const tiers: Card[] = [
    {
      title: "Starter",
      body: "$0 / month — Everything you need to compose your first pages and review them in Figma.",
      action: { type: "button", label: "Start free", variant: "outline", size: "md" },
    },
    {
      title: "Pro",
      body: "$29 / month — A full component library, unlimited pages, and the director review loop.",
      action: { type: "button", label: "Go Pro", variant: "primary", size: "md" },
    },
    {
      title: "Team",
      body: "$99 / month — Shared brand foundations and every page composed to one system across the team.",
      action: { type: "button", label: "Contact sales", variant: "outline", size: "md" },
    },
  ];

  return [
    navSection(name),
    {
      role: "hero",
      layout: "center",
      maxWidth: 900,
      eyebrow: "PRICING",
      headline: "Simple, transparent pricing",
      sub: `Start free and scale as ${name} composes more of your product.`,
    },
    {
      role: "card-grid",
      heading: "Choose your plan",
      columns: 3,
      cards: tiers,
    },
    {
      role: "cta",
      bg: "@primary",
      theme: "dark",
      headline: "Ready when you are",
      sub: "No card required to explore.",
      actions: [{ type: "button", label: "Get started", variant: "secondary", size: "lg" }],
    },
    footerSection(name),
  ];
}

/** Dashboard — a compact header + a stat-tile row (content) + module cards. */
function dashboard(ctx: ComposeCtx): Section[] {
  const { name } = ctx;

  const stats: Array<{ value: string; caption: string }> = [
    { value: "12.4k", caption: "Active users" },
    { value: "98.2%", caption: "Uptime" },
    { value: "$1.2M", caption: "Processed" },
    { value: "4.9/5", caption: "Satisfaction" },
  ];

  // A stat tile: a bordered @surface card holding a big number + a muted caption.
  const statTile = (stat: { value: string; caption: string }): Block => ({
    type: "stack",
    name: "stat",
    dir: "col",
    gap: 8,
    pad: 24,
    grow: 1,
    w: "fill",
    bg: "@surface",
    border: { color: "@border", width: 1 },
    radius: 12,
    children: [
      { type: "text", text: stat.value, style: "h1" },
      { type: "text", text: stat.caption, style: "small", color: "@muted" },
    ],
  });

  const statRow: Block = {
    type: "stack",
    name: "stats",
    dir: "row",
    gap: 24,
    w: "fill",
    children: stats.map(statTile),
  };

  const modules: Card[] = [
    { icon: "lucide:bar-chart-3", title: "Analytics", body: "Live metrics across every surface, refreshed in real time." },
    { icon: "lucide:users", title: "Audience", body: "Segment and follow the people using your product." },
    { icon: "lucide:credit-card", title: "Billing", body: "Revenue, invoices and plans in one calm view." },
    { icon: "lucide:settings", title: "Settings", body: "Configure your workspace, team and integrations." },
    { icon: "lucide:bell", title: "Alerts", body: "Know the moment something needs your attention." },
    { icon: "lucide:shield", title: "Security", body: "Audit logs and access control, always on." },
  ];

  return [
    navSection(name),
    {
      role: "hero",
      layout: "center",
      maxWidth: 900,
      eyebrow: "DASHBOARD",
      headline: `${name} overview`,
      sub: "Your product at a glance.",
    },
    { role: "content", bg: "@surface", children: [statRow] },
    {
      role: "card-grid",
      heading: "Modules",
      columns: 3,
      cards: modules,
    },
    footerSection(name),
  ];
}

/* ------------------------------------------------------------------------ */
/* Entry point                                                                */
/* ------------------------------------------------------------------------ */

/**
 * Build the Section list for one product page of `kind`, reusing the proven
 * Section system so the page looks designed and content varies by kind. Every
 * kind opens with a nav and closes with a footer (brand name = ctx.name). When
 * the caller has a live component library, a compact instantiation strip is
 * appended just before the footer.
 */
export function composeSections(kind: PageKind, ctx: ComposeCtx): Section[] {
  const build: Record<PageKind, (ctx: ComposeCtx) => Section[]> = {
    landing,
    features,
    pricing,
    dashboard,
  };
  const sections = build[kind](ctx);

  const strip = kitStrip(ctx);
  if (strip) {
    // Splice the "components in use" strip in just before the closing footer.
    const footerIdx = sections.length - 1;
    sections.splice(footerIdx, 0, strip);
  }
  return sections;
}
