/**
 * Worked example — a reusable Component + Instances.
 *
 * Declares a `FeatureCard` component with typed props (`title`, `body`,
 * `icon`) and a `footer` slot, then instantiates it three times with different
 * props and slot content. Demonstrates: `"@prop.name"` substitution in strings,
 * `{ type: "slot" }` expansion, and the `component` sidecar (`compile()` returns
 * `components["FeatureCard"] = { id: "dsl:FeatureCard", el, props }`).
 */

import { compile } from "../compile";
import { placeholderResolver } from "./landing";
import type { CompileResult } from "../compile";
import type { Component, DesignDoc, Instance } from "../schema";

const featureCard: Component = {
  name: "FeatureCard",
  props: [
    { name: "title", type: "text", default: "Untitled" },
    { name: "body", type: "text", default: "" },
    { name: "icon", type: "text", default: "lucide:sparkles" },
  ],
  slots: ["footer"],
  body: {
    type: "stack",
    name: "FeatureCard",
    dir: "col",
    gap: 12,
    pad: 24,
    w: "fill",
    bg: "@surface",
    radius: "md",
    shadow: "md",
    children: [
      { type: "icon", name: "@prop.icon", size: 32, color: "@primary" },
      { type: "text", text: "@prop.title", style: "h3" },
      { type: "text", text: "@prop.body", style: "body", color: "@muted" },
      { type: "slot", name: "footer" },
    ],
  },
};

function card(props: Instance["props"], footerLabel: string): Instance {
  return {
    type: "instance",
    component: "FeatureCard",
    props,
    slots: {
      footer: [{ type: "button", label: footerLabel, variant: "link" }],
    },
  };
}

export const featureCardDoc: DesignDoc = {
  version: "1",
  meta: { name: "Feature Cards" },
  brand: {
    colors: {
      bg: "#ffffff",
      surface: "#f1f5f9",
      text: "#111827",
      muted: "#6b7280",
      primary: "#2563eb",
      onPrimary: "#ffffff",
      border: "#e5e7eb",
    },
    type: {
      h3: { size: 20, weight: 600, line: 1.3, font: "heading" },
      body: { size: 16, weight: 400, line: 1.5, font: "body" },
    },
    radius: { md: 12 },
    shadow: { md: { x: 0, y: 4, blur: 12, spread: 0, color: "#00000014" } },
  },
  components: [featureCard],
  pages: [
    {
      name: "Cards",
      width: 1200,
      sections: [
        {
          role: "content",
          pad: [48, 24],
          children: [
            {
              type: "stack",
              name: "row",
              dir: "row",
              gap: 24,
              w: "fill",
              children: [
                { ...card({ title: "Fast", body: "Sub-100ms everywhere.", icon: "lucide:zap" }, "Learn more"), grow: 1 },
                { ...card({ title: "Secure", body: "Encrypted by default.", icon: "lucide:shield" }, "Read the docs"), grow: 1 },
                { ...card({ title: "Simple", body: "No setup required.", icon: "lucide:wand" }, "Get started"), grow: 1 },
              ],
            },
          ],
        },
      ],
    },
  ],
};

/** Compile the component example to PDS with the placeholder resolver. */
export function compileFeatureCards(): Promise<CompileResult> {
  return compile(featureCardDoc, { assets: placeholderResolver });
}
