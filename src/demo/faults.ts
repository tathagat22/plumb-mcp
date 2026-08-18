/**
 * The mistakes an agent actually makes, as data.
 *
 * `renderReference` gives us a perfect build. Each fault below takes that
 * snapshot and breaks it exactly the way a real coding agent breaks a real
 * screen — the type scale drifts one step, the pill button comes out as a
 * rounded rectangle, the gradient flattens to a flat fill, the badge never
 * gets built at all.
 *
 * Every fault declares the delta `kind`s the verify engine must report for it.
 * That turns the demo into a scored, falsifiable claim rather than a slideshow:
 * `npm run demo` injects N faults and asserts the engine found N — and found
 * nothing that wasn't injected. A regression that blinds a check shows up as a
 * missed fault; one that makes a check trigger-happy shows up as a false
 * positive on the untouched nodes.
 */
import type { RenderedElement } from "../verify";

export type FaultSeverity = "error" | "warn";

export interface Fault {
  /** Stable id — used to select which faults a round still carries. */
  id: string;
  /** What the agent got wrong, in the words a reviewer would use. */
  label: string;
  /** Roughly how bad: drives which repair round clears it. */
  severity: FaultSeverity;
  /**
   * What the engine must report because of this fault, as `"<el>:<kind>"`.
   *
   * `"<el>:coverage"` is the pseudo-kind for "this node must show up as
   * untagged" — a node that was never built produces no delta at all, only a
   * coverage hole, and that is precisely the failure mode a delta-only report
   * would miss.
   */
  expect: string[];
  /** Break the perfect snapshot. */
  apply: (elements: RenderedElement[]) => RenderedElement[];
}

/** In-place style patch on one tagged element. */
function patch(el: string, styles: Record<string, string>) {
  return (elements: RenderedElement[]): RenderedElement[] =>
    elements.map((e) => (e.el === el ? { ...e, styles: { ...e.styles, ...styles } } : e));
}

/** Drop elements entirely — the agent never built these nodes. */
function drop(...els: string[]) {
  const set = new Set(els);
  return (elements: RenderedElement[]): RenderedElement[] =>
    elements.filter((e) => !set.has(e.el));
}

/**
 * The catalogue. Ordered roughly by how much a reviewer would care, which is
 * also the order the demo prints them in.
 */
export const FAULTS: Fault[] = [
  {
    id: "unbuilt-badge",
    label: "The “MOST POPULAR” badge was never built — no element carries its handle",
    severity: "error",
    expect: ["pro-badge:coverage", "pro-badge-label:coverage"],
    apply: drop("pro-badge", "pro-badge-label"),
  },
  {
    id: "type-scale-drift",
    label: "Headline came out one step down the type scale (48px → 40px)",
    severity: "error",
    expect: ["title:text.size"],
    apply: patch("title", { fontSize: "40px", lineHeight: "44px" }),
  },
  {
    id: "brand-hue-drift",
    label: "Primary CTA is a hand-picked purple, not the brand token",
    severity: "error",
    expect: ["pro-cta:fill"],
    apply: patch("pro-cta", { backgroundColor: "rgb(124, 92, 245)" }),
  },
  {
    id: "card-padding",
    label: "Pro card padding tightened 32px → 24px on all four sides",
    severity: "error",
    expect: ["card-pro:pad.top", "card-pro:pad.right", "card-pro:pad.bottom", "card-pro:pad.left"],
    apply: patch("card-pro", {
      paddingTop: "24px",
      paddingRight: "24px",
      paddingBottom: "24px",
      paddingLeft: "24px",
    }),
  },
  {
    id: "column-gap",
    label: "Gap between the plan columns is 16px instead of 24px",
    severity: "error",
    expect: ["plans:layout.gap"],
    apply: patch("plans", { gap: "16px" }),
  },
  {
    id: "squared-pill",
    label: "Pill button rendered as a rounded rectangle (radius 6px, not fully round)",
    severity: "error",
    expect: ["starter-cta:radius"],
    apply: patch("starter-cta", { borderRadius: "6px" }),
  },
  {
    id: "flattened-radius",
    label: "Starter card corner radius flattened 20px → 8px",
    severity: "error",
    expect: ["card-starter:radius"],
    apply: patch("card-starter", { borderRadius: "8px" }),
  },
  {
    id: "dropped-shadow",
    label: "Pro card ships with no elevation — box-shadow never applied",
    severity: "error",
    expect: ["card-pro:shadow.missing"],
    apply: patch("card-pro", { boxShadow: "none" }),
  },
  {
    id: "wrong-flow",
    label: "Feature list stacked as a row instead of a column",
    severity: "error",
    expect: ["starter-features:layout.flow"],
    apply: patch("starter-features", { flexDirection: "row" }),
  },
  {
    id: "muted-text-drift",
    label: "Subtitle uses a darker grey than the muted token",
    severity: "error",
    expect: ["subtitle:text.color"],
    apply: patch("subtitle", { color: "rgb(100, 116, 139)" }),
  },
  {
    id: "flattened-gradient",
    label: "Pro card’s two-layer fill flattened to a single solid colour",
    severity: "warn",
    expect: ["card-pro:fills.count"],
    apply: (elements) =>
      elements.map((e) =>
        e.el === "card-pro"
          ? { ...e, styles: { ...e.styles, backgroundImage: "none" } }
          : e,
      ),
  },
  {
    id: "weight-drift",
    label: "Pro price rendered semibold (600) where the design is bold (700)",
    severity: "warn",
    expect: ["pro-price:text.weight"],
    apply: patch("pro-price", { fontWeight: "600" }),
  },
  {
    id: "stray-element",
    label: "A leftover promo ribbon is in the build but not in the design",
    severity: "warn",
    expect: ["promo-ribbon:missing-in-pds"],
    apply: (elements) => [
      ...elements,
      {
        el: "promo-ribbon",
        box: { x: 0, y: 0, w: 120, h: 28 },
        styles: { backgroundColor: "rgb(239, 68, 68)", borderRadius: "4px" },
        text: "LAUNCH WEEK",
      },
    ],
  },
];

/** Apply the named faults, in catalogue order, to a perfect snapshot. */
export function applyFaults(elements: RenderedElement[], ids: Iterable<string>): RenderedElement[] {
  const wanted = new Set(ids);
  let out = elements;
  for (const fault of FAULTS) {
    if (wanted.has(fault.id)) out = fault.apply(out);
  }
  return out;
}
