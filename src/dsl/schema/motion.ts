/**
 * Motion authoring: triggers, easings, transitions, interactions, and the
 * document-level prototype flow. Semantic at this layer — it compiles down to
 * the `MotionSpec[]` that rides on PdsNodes.
 */

import { z } from "zod";

// ============================================================================
// Motion authoring (semantic; compiles to MotionSpec[] on PdsNodes)
// ============================================================================

export type DslTrigger =
  | "click"
  | "hover"
  | "press"
  | "drag"
  | "mouse-enter"
  | "mouse-leave"
  | "mouse-down"
  | "mouse-up"
  | `key:${string}`
  | `after:${number}`;

export type DslEasing =
  | "linear"
  | "ease-in"
  | "ease-out"
  | "ease-in-out"
  | "ease-in-back"
  | "ease-out-back"
  | "ease-in-out-back"
  | "gentle"
  | "quick"
  | "bouncy"
  | "slow"
  | { bezier: [number, number, number, number] }
  | { spring: { mass: number; stiffness: number; damping: number } };

export interface DslTransition {
  kind:
    | "smart"
    | "dissolve"
    | "move-in"
    | "move-out"
    | "push"
    | "slide-in"
    | "slide-out"
    | "scroll-animate"
    | "instant";
  from?: "left" | "right" | "top" | "bottom";
  /** ms, default 300. */
  duration?: number;
  ease?: DslEasing;
  matchLayers?: boolean;
}

/** One interaction on any Block. Exactly one action verb should be set. */
export interface DslInteraction {
  on: DslTrigger;
  go?: string;
  swap?: string;
  overlay?: string;
  scrollTo?: string;
  back?: boolean;
  close?: boolean;
  url?: string;
  set?: Record<string, string | number | boolean>;
  animate?: DslTransition;
  keepScroll?: boolean;
  resetState?: boolean;
}

export interface DslOverlayConfig {
  position?:
    | "center"
    | "top"
    | "bottom"
    | "left"
    | "right"
    | "top-left"
    | "top-right"
    | "bottom-left"
    | "bottom-right"
    | "manual";
  at?: { x: number; y: number };
  backdrop?: string;
  closeOnClickOutside?: boolean;
}

export interface DslPrototype {
  device?: "none" | { preset: string } | { size: { w: number; h: number } };
  rotation?: "portrait" | "landscape";
  background?: string;
  /** Starting screen id; else the first page with `start`. */
  start?: string;
}

// ---- Motion ---------------------------------------------------------------

const DslTriggerSchema = z
  .string()
  .refine(
    (s) =>
      [
        "click",
        "hover",
        "press",
        "drag",
        "mouse-enter",
        "mouse-leave",
        "mouse-down",
        "mouse-up",
      ].includes(s) ||
      /^key:.+$/.test(s) ||
      /^after:\d+$/.test(s),
    { message: "invalid trigger" },
  ) as z.ZodType<DslTrigger>;

const DslEasingSchema: z.ZodType<DslEasing> = z.union([
  z.enum([
    "linear",
    "ease-in",
    "ease-out",
    "ease-in-out",
    "ease-in-back",
    "ease-out-back",
    "ease-in-out-back",
    "gentle",
    "quick",
    "bouncy",
    "slow",
  ]),
  z.object({ bezier: z.tuple([z.number(), z.number(), z.number(), z.number()]) }),
  z.object({
    spring: z.object({ mass: z.number(), stiffness: z.number(), damping: z.number() }),
  }),
]);

const DslTransitionSchema: z.ZodType<DslTransition> = z.object({
  kind: z.enum([
    "smart",
    "dissolve",
    "move-in",
    "move-out",
    "push",
    "slide-in",
    "slide-out",
    "scroll-animate",
    "instant",
  ]),
  from: z.enum(["left", "right", "top", "bottom"]).optional(),
  duration: z.number().optional(),
  ease: DslEasingSchema.optional(),
  matchLayers: z.boolean().optional(),
});

export const DslInteractionSchema: z.ZodType<DslInteraction> = z.object({
  on: DslTriggerSchema,
  go: z.string().optional(),
  swap: z.string().optional(),
  overlay: z.string().optional(),
  scrollTo: z.string().optional(),
  back: z.boolean().optional(),
  close: z.boolean().optional(),
  url: z.string().optional(),
  set: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional(),
  animate: DslTransitionSchema.optional(),
  keepScroll: z.boolean().optional(),
  resetState: z.boolean().optional(),
});

export const DslOverlayConfigSchema: z.ZodType<DslOverlayConfig> = z.object({
  position: z
    .enum([
      "center",
      "top",
      "bottom",
      "left",
      "right",
      "top-left",
      "top-right",
      "bottom-left",
      "bottom-right",
      "manual",
    ])
    .optional(),
  at: z.object({ x: z.number(), y: z.number() }).optional(),
  backdrop: z.string().optional(),
  closeOnClickOutside: z.boolean().optional(),
});

export const DslPrototypeSchema: z.ZodType<DslPrototype> = z.object({
  device: z
    .union([
      z.literal("none"),
      z.object({ preset: z.string() }),
      z.object({ size: z.object({ w: z.number(), h: z.number() }) }),
    ])
    .optional(),
  rotation: z.enum(["portrait", "landscape"]).optional(),
  background: z.string().optional(),
  start: z.string().optional(),
});
