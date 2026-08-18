import { describe, expect, it, vi } from "vitest";
import type { DslInteraction } from "../schema";
import {
  compileInteraction,
  compileInteractions,
  compileOverlayCfg,
  compilePrototype,
} from "./compile";
import { buildMotionPlan, isEmptyMotionPlan } from "./plan";
import type { MotionPdsDocument, MotionPdsNode } from "./types";

/**
 * Motion is the part of a generated design that is invisible until someone
 * clicks — a broken interaction ships looking perfect and fails in the
 * prototype review. Two conversions have to hold: authored DSL down to the
 * read-symmetric `AuthoredMotionSpec`, and the assembled document down to the
 * wire payload the plugin executor replays.
 *
 * The rule threaded through both is that anything the executor cannot act on
 * is dropped HERE, with a warning, rather than sent and silently ignored.
 */

const interaction = (over: Partial<DslInteraction> = {}): DslInteraction => ({
  on: "click",
  go: "Pricing",
  ...over,
});

describe("compileInteraction", () => {
  it("compiles a click-to-navigate", () => {
    const spec = compileInteraction(interaction());
    expect(spec).toMatchObject({ trigger: "ON_CLICK", navigation: "NAVIGATE", target: "Pricing" });
  });

  it.each([
    ["click", "ON_CLICK"],
    ["hover", "ON_HOVER"],
    ["press", "ON_PRESS"],
    ["drag", "ON_DRAG"],
    ["mouse-enter", "MOUSE_ENTER"],
    ["mouse-leave", "MOUSE_LEAVE"],
    ["mouse-down", "MOUSE_DOWN"],
    ["mouse-up", "MOUSE_UP"],
  ] as const)("maps the %s trigger to %s", (on, trigger) => {
    expect(compileInteraction(interaction({ on }))?.trigger).toBe(trigger);
  });

  it.each([
    ["swap", "SWAP"],
    ["overlay", "OVERLAY"],
    ["scrollTo", "SCROLL_TO"],
  ] as const)("maps the %s verb to %s", (verb, navigation) => {
    const spec = compileInteraction({ on: "click", [verb]: "Target" } as DslInteraction);
    expect(spec).toMatchObject({ navigation, target: "Target" });
  });

  it("compiles the argument-free verbs", () => {
    expect(compileInteraction({ on: "click", back: true })?.navigation).toBe("BACK");
    expect(compileInteraction({ on: "click", close: true })?.navigation).toBe("CLOSE");
  });

  it("compiles a URL action, carrying the href rather than a target el", () => {
    const spec = compileInteraction({ on: "click", url: "https://example.com" });
    expect(spec?.navigation).toBe("URL");
    expect(spec).not.toHaveProperty("target");
  });

  it("compiles a variable assignment", () => {
    const spec = compileInteraction({ on: "click", set: { theme: "dark" } });
    expect(spec?.navigation).toBe("SET_VAR");
  });

  it("returns null and warns for an interaction with no action verb", () => {
    // An interaction that does nothing is an authoring mistake worth telling
    // someone about, not a spec worth emitting.
    const warn = vi.fn();
    expect(compileInteraction({ on: "click" }, { warn })).toBeNull();
    expect(warn).toHaveBeenCalledOnce();
  });

  it("resolves a target ref through the context when one is supplied", () => {
    const spec = compileInteraction(interaction({ go: "Pricing" }), {
      resolveTarget: (ref) => (ref === "Pricing" ? "sec-3" : ref),
    });
    expect(spec?.target).toBe("sec-3");
  });

  it("passes a target through unchanged when nothing resolves it", () => {
    expect(compileInteraction(interaction({ go: "Pricing" }))?.target).toBe("Pricing");
  });

  it("takes the first verb when an author supplies several", () => {
    // Ambiguous input has to resolve deterministically, or the same document
    // compiles differently on different runs.
    const spec = compileInteraction({ on: "click", go: "A", swap: "B", close: true });
    expect(spec?.navigation).toBe("NAVIGATE");
    expect(spec?.target).toBe("A");
  });

  it("carries an animation transition through", () => {
    const spec = compileInteraction(
      interaction({ animate: { kind: "smart", duration: 300, ease: "ease-out" } }),
    );
    expect(spec?.kind).toBeTruthy();
  });
});

describe("compileInteractions", () => {
  it("returns an empty list for no interactions", () => {
    expect(compileInteractions(undefined)).toEqual([]);
    expect(compileInteractions([])).toEqual([]);
  });

  it("compiles each interaction in order", () => {
    const specs = compileInteractions([
      interaction({ go: "A" }),
      interaction({ on: "hover", go: "B" }),
    ]);
    expect(specs.map((s) => s.target)).toEqual(["A", "B"]);
  });

  it("drops the ones that compile to nothing and keeps the rest", () => {
    const specs = compileInteractions([{ on: "click" }, interaction({ go: "A" })]);
    expect(specs).toHaveLength(1);
    expect(specs[0]?.target).toBe("A");
  });
});

describe("compileOverlayCfg", () => {
  it("returns undefined when there is no config", () => {
    expect(compileOverlayCfg(undefined)).toBeUndefined();
  });

  it("carries position, anchor, backdrop and the outside-click behaviour", () => {
    const cfg = compileOverlayCfg({
      position: "center",
      at: { x: 10, y: 20 },
      backdrop: "#00000080",
      closeOnClickOutside: true,
    });
    expect(cfg).toMatchObject({
      position: "center",
      at: { x: 10, y: 20 },
      backdrop: "#00000080",
      closeOnClickOutside: true,
    });
  });

  it("keeps closeOnClickOutside: false rather than treating it as unset", () => {
    // `false` is a deliberate authoring choice — a modal you must dismiss
    // explicitly — and dropping it would silently change the behaviour.
    expect(compileOverlayCfg({ closeOnClickOutside: false })?.closeOnClickOutside).toBe(false);
  });

  it("emits an empty object for a config that sets nothing", () => {
    expect(compileOverlayCfg({})).toEqual({});
  });
});

describe("compilePrototype", () => {
  it("returns undefined when there is neither a prototype nor a start frame", () => {
    expect(compilePrototype(undefined, [])).toBeUndefined();
  });

  it("emits the start frames even with no authored prototype block", () => {
    const proto = compilePrototype(undefined, [{ el: "home", name: "Home" }]);
    expect(proto?.starts).toEqual([{ el: "home", name: "Home" }]);
  });

  it("carries the background an author set", () => {
    expect(compilePrototype({ background: "#0b1120" }, [])?.background).toBe("#0b1120");
  });

  it("folds rotation into the device rather than leaving it loose", () => {
    // Figma has no free-standing rotation — it is a property of the device
    // frame, so an authored `rotation` has to land there or it is lost.
    const proto = compilePrototype({ device: { preset: "iphone-15" }, rotation: "landscape" }, []);
    expect(proto?.device?.rotation).toBeTruthy();
  });

  it("carries a device preset", () => {
    expect(compilePrototype({ device: { preset: "iphone-15" } }, [])?.device).toBeTruthy();
  });

  it("carries a custom device size", () => {
    const proto = compilePrototype({ device: { size: { w: 390, h: 844 } } }, []);
    expect(proto?.device).toMatchObject({ kind: "custom", size: { w: 390, h: 844 } });
  });

  it("records several start frames", () => {
    const proto = compilePrototype(undefined, [
      { el: "home", name: "Home" },
      { el: "pricing", name: "Pricing" },
    ]);
    expect(proto?.starts).toEqual([
      { el: "home", name: "Home" },
      { el: "pricing", name: "Pricing" },
    ]);
  });
});

describe("buildMotionPlan", () => {
  /** A minimal PdsNode carrying only the motion fields under test. */
  const n = (el: string, over: Partial<MotionPdsNode> = {}): MotionPdsNode =>
    ({ id: `1:${el}`, el, type: "frame", box: { w: 10, h: 10 }, ...over }) as MotionPdsNode;

  const doc = (nodes: Record<string, MotionPdsNode>, over: Partial<MotionPdsDocument> = {}) =>
    ({ nodes, ...over }) as MotionPdsDocument;

  it("produces an empty plan for a document with no motion at all", () => {
    const plan = buildMotionPlan(doc({ root: n("root") }));
    expect(plan.bindings).toEqual([]);
    expect(plan.frames).toEqual([]);
    expect(isEmptyMotionPlan(plan)).toBe(true);
  });

  it("binds a node's compiled interactions", () => {
    const specs = compileInteractions([interaction({ go: "pricing" })]);
    const plan = buildMotionPlan(doc({ cta: n("cta", { motion: specs }) }));
    expect(plan.bindings).toHaveLength(1);
    expect(plan.bindings[0]?.sourceEl).toBe("cta");
    expect(isEmptyMotionPlan(plan)).toBe(false);
  });

  it("emits a frame entry for a node with scroll overflow", () => {
    const plan = buildMotionPlan(doc({ page: n("page", { overflow: "vertical" }) }));
    expect(plan.frames).toHaveLength(1);
    expect(plan.frames[0]?.el).toBe("page");
  });

  it("emits a frame entry for a node with overlay config", () => {
    const plan = buildMotionPlan(
      doc({ modal: n("modal", { overlayCfg: { position: "center" } }) }),
    );
    expect(plan.frames).toHaveLength(1);
  });

  it("carries the document prototype into the plan", () => {
    const plan = buildMotionPlan(
      doc({ home: n("home") }, { prototype: { starts: [{ el: "home", name: "Home" }] } }),
    );
    expect(plan.prototype?.starts.length).toBe(1);
    expect(isEmptyMotionPlan(plan)).toBe(false);
  });

  it("skips a node whose motion list is empty", () => {
    expect(buildMotionPlan(doc({ cta: n("cta", { motion: [] }) })).bindings).toEqual([]);
  });

  it("is deterministic", () => {
    const specs = compileInteractions([interaction({ go: "a" }), interaction({ on: "hover", go: "b" })]);
    const input = doc({ cta: n("cta", { motion: specs }), page: n("page", { overflow: "both" }) });
    expect(buildMotionPlan(input)).toEqual(buildMotionPlan(input));
  });
});

describe("isEmptyMotionPlan", () => {
  it("treats a prototype with no starts, device or background as empty", () => {
    // Otherwise an untouched document ships an `apply-motion` round trip that
    // does nothing.
    expect(
      isEmptyMotionPlan({ bindings: [], frames: [], prototype: { starts: [] } }),
    ).toBe(true);
  });

  it("is not empty once anything is bound", () => {
    expect(
      isEmptyMotionPlan({
        bindings: [{ sourceEl: "a", specs: [] }],
        frames: [],
      }),
    ).toBe(false);
  });
});
