/**
 * Worked example — a full landing page authored in the Design DSL.
 *
 * Exercises most section roles (nav / hero / features / card-grid / cta /
 * footer), brand tokens (colours, a type scale, spacing + radius + shadow
 * scales), asset-by-query references (nav logo, hero art, feature photos,
 * button icon), and a click interaction. Compile it with `compile(landingDoc,
 * ctx)`; `compileExample()` below wires a keyless placeholder resolver so the
 * example round-trips to PDS with zero external calls.
 */

import { compile } from "../compile";
import type { CompileResult } from "../compile";
import type { AssetResolver, AssetSpec, DesignDoc, ResolvedAsset } from "../schema";

export const landingDoc: DesignDoc = {
  version: "1",
  meta: { name: "Nimbus — Landing", description: "Marketing landing page for a SaaS product." },
  brand: {
    fonts: { heading: "Inter", body: "Inter", mono: "JetBrains Mono" },
    colors: {
      bg: "#ffffff",
      surface: "#f8fafc",
      text: "#0f172a",
      muted: "#64748b",
      primary: "#4f46e5",
      onPrimary: "#ffffff",
      border: "#e2e8f0",
      accent: "#06b6d4",
    },
    type: {
      display: { size: 56, weight: 800, line: 1.05, tracking: -1, font: "heading" },
      h1: { size: 40, weight: 700, line: 1.1, font: "heading" },
      h2: { size: 30, weight: 700, line: 1.15, font: "heading" },
      h3: { size: 20, weight: 600, line: 1.3, font: "heading" },
      body: { size: 17, weight: 400, line: 1.6, font: "body" },
      small: { size: 14, weight: 400, line: 1.5, font: "body" },
      label: { size: 13, weight: 600, line: 1.2, tracking: 0.4, font: "body", transform: "upper" },
    },
    spacing: { xs: 4, sm: 8, md: 16, lg: 32, xl: 64 },
    radius: { sm: 6, md: 10, lg: 16, full: "full" },
    shadow: {
      md: { x: 0, y: 8, blur: 24, spread: -4, color: "#0f172a1f" },
    },
  },
  pages: [
    {
      name: "Home",
      width: 1440,
      bg: "@bg",
      sections: [
        {
          role: "nav",
          sticky: true,
          brand: { logo: { query: "nimbus logo", kind: "logo", role: "nav-logo" }, text: "Nimbus" },
          links: [
            { label: "Product", href: "#product" },
            { label: "Pricing", href: "#pricing" },
            { label: "Docs", href: "#docs" },
          ],
          actions: [
            { type: "button", label: "Sign in", variant: "ghost" },
            { type: "button", label: "Get started", variant: "primary", icon: "lucide:arrow-right", iconPos: "right" },
          ],
        },
        {
          role: "hero",
          layout: "split-right",
          maxWidth: 1200,
          eyebrow: "Ship faster",
          headline: [
            { t: "The workspace that " },
            { t: "moves with you", color: "@primary" },
          ],
          sub: "Nimbus unifies docs, tasks, and automation in one calm, fast surface — so your team spends time building, not switching tabs.",
          actions: [
            { type: "button", label: "Start free", variant: "primary", size: "lg" },
            { type: "button", label: "Watch demo", variant: "outline", size: "lg", icon: "lucide:play" },
          ],
          media: {
            type: "image",
            src: { query: "team collaboration dashboard", kind: "illustration", role: "hero" },
            w: "fill",
            h: 420,
            radius: "lg",
          },
        },
        {
          role: "features",
          heading: "Everything in one place",
          bg: "@surface",
          layout: "row",
          features: [
            { icon: "lucide:zap", title: "Blazing fast", body: "Instant search and sub-100ms navigation across your whole workspace." },
            { icon: "lucide:lock", title: "Private by default", body: "End-to-end encrypted, SOC 2 Type II, and self-host ready." },
            { icon: "lucide:workflow", title: "Automate anything", body: "Trigger flows from any event with a visual builder — no code needed." },
          ],
        },
        {
          role: "card-grid",
          heading: "Loved by fast teams",
          columns: 3,
          cards: [
            { image: { query: "portrait developer", kind: "photo" }, title: "Acme", body: "\"Cut our tooling from six apps to one.\"" },
            { image: { query: "portrait designer", kind: "photo" }, title: "Globex", body: "\"The fastest tool our team has ever used.\"" },
            { image: { query: "portrait founder", kind: "photo" }, title: "Initech", body: "\"Onboarding went from days to minutes.\"" },
          ],
        },
        {
          role: "cta",
          bg: "@primary",
          theme: "dark",
          headline: "Start building today",
          sub: "Free for up to 5 teammates. No credit card required.",
          actions: [{ type: "button", label: "Create your workspace", variant: "secondary", size: "lg" }],
        },
        {
          role: "footer",
          bg: "@surface",
          brand: { text: "Nimbus" },
          columns: [
            { title: "Product", links: [{ label: "Features" }, { label: "Pricing" }, { label: "Changelog" }] },
            { title: "Company", links: [{ label: "About" }, { label: "Careers" }, { label: "Blog" }] },
            { title: "Legal", links: [{ label: "Privacy" }, { label: "Terms" }] },
          ],
          legal: "© 2026 Nimbus, Inc. All rights reserved.",
        },
      ],
    },
  ],
};

/**
 * Keyless placeholder resolver — returns an empty ResolvedAsset so the compiler
 * degrades every asset to a placeholder (never throws). The real asset engine
 * (src/assets/*) replaces this in production; this keeps the example
 * self-contained and side-effect-free.
 */
export const placeholderResolver: AssetResolver = {
  async resolve(spec: AssetSpec): Promise<ResolvedAsset> {
    return { kind: spec.kind ?? "photo", w: spec.w, h: spec.h };
  },
};

/** Compile the landing example to PDS with the placeholder resolver. */
export function compileExample(): Promise<CompileResult> {
  return compile(landingDoc, { assets: placeholderResolver });
}
