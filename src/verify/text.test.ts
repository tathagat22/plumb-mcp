import { describe, expect, it } from "vitest";
import type { PdsDocument, PdsNode } from "../pds";
import { collectDuplicateChars, isPlaceholderText } from "./text";

/**
 * This is the module that decides whether a string mismatch is a bug or the
 * agent doing its job. Both directions cost something: over-flagging fills the
 * fix list with "you replaced 'Lorem ipsum' with real copy", and under-flagging
 * lets a genuinely wrong button label ship silently.
 */

const text = (el: string, chars: string): PdsNode => ({
  id: `1:${el}`,
  el,
  type: "text",
  box: { w: 100, h: 20 },
  chars,
});

function doc(nodes: PdsNode[]): PdsDocument {
  const map: Record<string, PdsNode> = {};
  for (const n of nodes) map[n.el] = n;
  return {
    schemaVersion: "1.0.0",
    file: { name: "test", version: "1" },
    root: nodes[0]!.el,
    tokens: { color: {}, text: {}, radius: {}, shadow: {} },
    nodes: map,
    meta: { nodeCount: nodes.length, estTokens: 0, depthUsed: 1 },
    next: "",
  };
}

describe("collectDuplicateChars", () => {
  it("collects a string the design repeats three or more times", () => {
    const d = doc([
      text("a", "Row label"),
      text("b", "Row label"),
      text("c", "Row label"),
      text("d", "Submit"),
    ]);
    expect([...collectDuplicateChars(d)]).toEqual(["Row label"]);
  });

  it("leaves a string repeated only twice alone", () => {
    // Two identical labels is normal design (a header and a footer link);
    // three is a designer duplicating a row to show layout.
    const d = doc([text("a", "Pricing"), text("b", "Pricing"), text("c", "Docs")]);
    expect(collectDuplicateChars(d).size).toBe(0);
  });

  it("trims before comparing, so whitespace variants still cluster", () => {
    const d = doc([text("a", "Item"), text("b", " Item "), text("c", "Item\n")]);
    expect(collectDuplicateChars(d).has("Item")).toBe(true);
  });

  it("returns an empty set for a design with no text at all", () => {
    const d = doc([{ id: "1:1", el: "root", type: "frame", box: { w: 1, h: 1 } }]);
    expect(collectDuplicateChars(d).size).toBe(0);
  });
});

describe("isPlaceholderText", () => {
  it("treats anything the design repeats as filler, whatever it says", () => {
    // The duplicate signal outranks the content: a repeated "Submit" is a
    // copy-pasted template cell.
    expect(isPlaceholderText("Submit", true)).toBe(true);
  });

  it.each([
    "Title",
    "Subtitle",
    "Heading",
    "Body text",
    "Label",
    "Description",
    "Your name",
    "Email address",
    "Company name",
  ])("recognises the generic slot label %s", (s) => {
    expect(isPlaceholderText(s, false)).toBe(true);
  });

  it("is case-insensitive about those labels", () => {
    expect(isPlaceholderText("EMAIL ADDRESS", false)).toBe(true);
  });

  it.each(["Lorem ipsum dolor sit", "dummy content", "placeholder here", "Sample text"])(
    "recognises the filler phrase %s",
    (s) => {
      expect(isPlaceholderText(s, false)).toBe(true);
    },
  );

  it("treats long body copy as content the agent is meant to replace", () => {
    const long = "Ship the design your team approved, not an approximation of it. ";
    expect(long.length).toBeGreaterThan(60);
    expect(isPlaceholderText(long, false)).toBe(true);
    expect(isPlaceholderText(long.slice(0, 60).trim(), false)).toBe(false);
  });

  it.each(["xxx", "•••", "———", "...."])("recognises the repeated-character stub %s", (s) => {
    expect(isPlaceholderText(s, false)).toBe(true);
  });

  it.each(["$0.00", "1,234", "00:00", "12%", "(0)", "+1", "0 / 0"])(
    "recognises the numeric stub %s",
    (s) => {
      expect(isPlaceholderText(s, false)).toBe(true);
    },
  );

  it("does not treat a lone dash as a numeric stub — the rule needs a digit", () => {
    // Documented so the next reader doesn't "fix" the comment by loosening the
    // rule: a bare em-dash is a legitimate label often enough that flagging it
    // would cost more than it saves.
    expect(isPlaceholderText("—", false)).toBe(false);
  });

  it("treats an empty string as filler", () => {
    expect(isPlaceholderText("   ", false)).toBe(true);
  });

  it.each([
    "Start free",
    "Choose Pro",
    "Talk to sales",
    "Simple, honest pricing",
    "Most popular",
  ])("does NOT flag the real UI label %s", (s) => {
    // These are the strings that must still warn on a mismatch — a button
    // that says the wrong thing is a bug, not content substitution.
    expect(isPlaceholderText(s, false)).toBe(false);
  });

  it("does not flag a short string that merely contains a digit", () => {
    expect(isPlaceholderText("Plan 2 seats", false)).toBe(false);
  });
});
