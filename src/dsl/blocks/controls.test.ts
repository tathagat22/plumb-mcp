import { describe, expect, it } from "vitest";
import type { Brand, Button, Field, Stack, Text } from "../schema";
import { buttonToStack, fieldToStack } from "./controls";

/**
 * A `button` is the block an author writes most and thinks about least, which
 * makes its desugaring the place where a generated design quietly stops
 * looking designed: the wrong padding scale, a label that inherits the page
 * text colour instead of the on-primary role, an outline variant that keeps a
 * background. These specs pin the variant contract rather than exact pixel
 * values, so the scale can be retuned without rewriting the suite.
 */

const brand = (over: Partial<Brand> = {}): Brand => ({
  colors: { bg: "#0b1120", text: "#f8fafc", primary: "#6366f1" },
  type: { body: { size: 16 } },
  ...over,
});

const button = (over: Partial<Button> = {}): Button => ({
  type: "button",
  label: "Start free",
  ...over,
});

/** The label is always the last text child, whichever side the icon sits on. */
const labelOf = (stack: Stack): Text =>
  stack.children.find((c): c is Text => c.type === "text")!;

describe("buttonToStack", () => {
  it("produces a centred row stack carrying the label", () => {
    const stack = buttonToStack(button(), brand());
    expect(stack.type).toBe("stack");
    expect(stack.dir).toBe("row");
    expect(stack.align).toBe("center");
    expect(stack.justify).toBe("center");
    expect(labelOf(stack).text).toBe("Start free");
  });

  it("defaults to the primary variant", () => {
    const stack = buttonToStack(button(), brand());
    expect(stack.bg).toBe("@primary");
    expect(labelOf(stack).color).toBe("@onPrimary");
  });

  it("gives the outline variant a border and no background", () => {
    // An outline button that keeps a fill is the single most common way a
    // generated CTA row stops reading as a hierarchy.
    const stack = buttonToStack(button({ variant: "outline" }), brand());
    expect(stack.bg).toBeUndefined();
    expect(stack.border).toMatchObject({ color: "@primary", width: 1 });
    expect(labelOf(stack).color).toBe("@primary");
  });

  it("gives the ghost variant neither a background nor a border", () => {
    const stack = buttonToStack(button({ variant: "ghost" }), brand());
    expect(stack.bg).toBeUndefined();
    expect(stack.border).toBeUndefined();
    expect(labelOf(stack).color).toBe("@primary");
  });

  it("renders a link variant as underlined text with no padding or radius", () => {
    const stack = buttonToStack(button({ variant: "link" }), brand());
    expect(stack.pad).toBe(0);
    expect(stack).not.toHaveProperty("radius");
    expect(labelOf(stack).style).toMatchObject({ decoration: "underline" });
  });

  it("uses the brand's surface role for secondary when the brand defines one", () => {
    const withSurface = brand({
      colors: { bg: "#0b1120", text: "#f8fafc", primary: "#6366f1", surface: "#141c31" },
    });
    expect(buttonToStack(button({ variant: "secondary" }), withSurface).bg).toBe("@surface");
  });

  it("falls back to muted for secondary when the brand has no surface", () => {
    expect(buttonToStack(button({ variant: "secondary" }), brand()).bg).toBe("@muted");
  });

  it.each(["sm", "md", "lg"] as const)("scales padding and label size for %s", (size) => {
    const stack = buttonToStack(button({ size }), brand());
    expect(Array.isArray(stack.pad)).toBe(true);
    expect(typeof labelOf(stack).style).toBe("object");
  });

  it("grows padding and type together as the size increases", () => {
    const sizes = (["sm", "md", "lg"] as const).map((size) => {
      const stack = buttonToStack(button({ size }), brand());
      const pad = stack.pad as [number, number];
      const style = labelOf(stack).style as { size: number };
      return { vertical: pad[0], label: style.size };
    });
    expect(sizes[0]!.vertical).toBeLessThan(sizes[2]!.vertical);
    expect(sizes[0]!.label).toBeLessThan(sizes[2]!.label);
  });

  it("puts the icon before the label by default", () => {
    const stack = buttonToStack(button({ icon: "arrow-right" }), brand());
    expect(stack.children.map((c) => c.type)).toEqual(["icon", "text"]);
  });

  it("puts the icon after the label when iconPos is right", () => {
    const stack = buttonToStack(button({ icon: "arrow-right", iconPos: "right" }), brand());
    expect(stack.children.map((c) => c.type)).toEqual(["text", "icon"]);
  });

  it("tints the icon to match the label, not the page text", () => {
    const stack = buttonToStack(button({ variant: "outline", icon: "lock" }), brand());
    const icon = stack.children.find((c) => c.type === "icon")!;
    expect((icon as { color?: string }).color).toBe(labelOf(stack).color);
  });

  it("emits only the label when there is no icon", () => {
    expect(buttonToStack(button(), brand()).children).toHaveLength(1);
  });

  it("prefers the brand's md radius token over a hard-coded fallback", () => {
    const withRadius = brand({ radius: { md: 10 } });
    expect(buttonToStack(button(), withRadius).radius).toBe("md");
    expect(buttonToStack(button(), brand()).radius).toBe(8);
  });

  it("lets an explicit radius win over the brand token", () => {
    expect(buttonToStack(button({ radius: 999 }), brand({ radius: { md: 10 } })).radius).toBe(999);
  });

  it("names the stack after the label when the author gave no name", () => {
    expect(buttonToStack(button(), brand()).name).toBe("Start free");
    expect(buttonToStack(button({ name: "CTA" }), brand()).name).toBe("CTA");
  });

  it.each(["w", "grow", "self", "pos", "shadow", "interactions"] as const)(
    "carries the author's %s through to the stack",
    (key) => {
      const values: Record<string, unknown> = {
        w: 240,
        grow: 1,
        self: "center",
        pos: { x: 1, y: 2 },
        shadow: "md",
        interactions: [{ on: "click", go: "next" }],
      };
      const stack = buttonToStack(button({ [key]: values[key] } as Partial<Button>), brand());
      expect(stack[key as keyof Stack]).toEqual(values[key]);
    },
  );

  it("omits every optional field the author did not set", () => {
    // A desugarer that emits `undefined` keys makes every downstream diff
    // noisier than the design change that caused it.
    const stack = buttonToStack(button(), brand());
    for (const key of ["w", "grow", "self", "pos", "shadow", "interactions", "border"]) {
      expect(Object.hasOwn(stack, key), key).toBe(false);
    }
  });
});

describe("fieldToStack", () => {
  const field = (over: Partial<Field> = {}): Field => ({ type: "field", ...over });

  it("produces a column stack", () => {
    expect(fieldToStack(field()).dir).toBe("col");
  });

  it("emits a label above the input when one is given", () => {
    const stack = fieldToStack(field({ label: "Email" }));
    const first = stack.children[0] as Text;
    expect(first.type).toBe("text");
    expect(first.text).toBe("Email");
  });

  it("emits only the input when there is no label", () => {
    const stack = fieldToStack(field());
    expect(stack.children.every((c) => c.type !== "text")).toBe(true);
  });

  it("renders the placeholder in the muted role, not the text role", () => {
    // Placeholder text at full contrast reads as a filled-in value.
    const stack = fieldToStack(field({ placeholder: "you@example.com" }));
    const input = stack.children.find((c) => c.type === "stack") as Stack;
    const placeholder = input.children.find((c): c is Text => c.type === "text")!;
    expect(placeholder.text).toBe("you@example.com");
    expect(placeholder.color).toBe("@muted");
  });

  it("leaves the input empty when there is no placeholder", () => {
    const stack = fieldToStack(field({ label: "Email" }));
    const input = stack.children.find((c) => c.type === "stack") as Stack;
    expect(input.children).toHaveLength(0);
  });

  it("produces a stack for every field kind it accepts", () => {
    for (const kind of ["text", "email", "password", "textarea", "select"] as const) {
      const stack = fieldToStack(field({ kind }));
      expect(stack.type, kind).toBe("stack");
      expect(stack.children.length, kind).toBeGreaterThan(0);
    }
  });
});
