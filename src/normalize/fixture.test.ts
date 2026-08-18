import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { FigmaFileResult, FigmaNode } from "../figma/types";
import { PDS_SCHEMA_VERSION } from "../pds";
import { lowerToEmitPlan } from "../emit/plan";
import { describePds } from "../describe";
import { critiqueDesign } from "../review/rubric";
import { pdsToRendered } from "../review/pdsAdapter";
import { verifyAgainst } from "../verify";
import { normalize } from "./normalize";

/**
 * `normalize()` against a real Figma export, rather than a hand-built node
 * tree.
 *
 * Every other normalize spec constructs exactly the input it wants to test,
 * which is the right way to pin one behaviour and the wrong way to notice that
 * real Figma data has a field nobody anticipated. This one runs the bundled
 * `scripts/fixtures/export-employees.json` — an actual exported dialog, with
 * the auto-layout, nested frames, text, and paints a real screen carries —
 * and then feeds the result through every downstream consumer, because the
 * whole value of one normalized shape is that they all accept it.
 */

const fixture: FigmaNode = JSON.parse(
  readFileSync(fileURLToPath(new URL("../../scripts/fixtures/export-employees.json", import.meta.url)), "utf8"),
) as FigmaNode;

const file: FigmaFileResult = {
  document: fixture,
  fileName: "Export employees",
  version: "1",
};

const pds = normalize(file, 12);

describe("normalizing a real Figma export", () => {
  it("produces a document at the current schema version", () => {
    expect(pds.schemaVersion).toBe(PDS_SCHEMA_VERSION);
    expect(pds.file.name).toBe("Export employees");
  });

  it("keeps every visible node, and only those", () => {
    // The fixture carries a hidden "Legacy footer" frame. A layer someone
    // switched off is not part of the design to build, and shipping it would
    // both cost tokens and have an agent render something invisible.
    const visible = (n: FigmaNode): number =>
      n.visible === false ? 0 : 1 + (n.children ?? []).reduce((sum, c) => sum + visible(c), 0);
    const all = (n: FigmaNode): number =>
      1 + (n.children ?? []).reduce((sum, c) => sum + all(c), 0);

    expect(all(fixture)).toBeGreaterThan(visible(fixture));
    expect(Object.keys(pds.nodes).length).toBe(visible(fixture));
  });

  it("drops the hidden layer by name, not by accident", () => {
    const names = Object.values(pds.nodes).map((n) => n.name);
    expect(names).not.toContain("Legacy footer");
  });

  it("roots the document at the exported frame", () => {
    expect(pds.nodes[pds.root]?.name).toBe(fixture.name);
  });

  it("resolves every child reference", () => {
    for (const node of Object.values(pds.nodes)) {
      for (const child of node.children ?? []) {
        expect(pds.nodes[child], `${node.el} → ${child}`).toBeDefined();
      }
    }
  });

  it("mints unique handles", () => {
    const els = Object.values(pds.nodes).map((n) => n.el);
    expect(new Set(els).size).toBe(els.length);
  });

  it("resolves Figma auto-layout into flexbox terms", () => {
    // The single biggest thing normalize buys a consumer: `layoutMode:
    // "VERTICAL"` and a counter-axis alignment become a flow and a
    // justify/align pair nobody downstream has to re-derive.
    const root = pds.nodes[pds.root]!;
    const layout = typeof root.layout === "string" ? pds.tokens.layout?.[root.layout] : root.layout;
    expect(layout?.flow).toBe("col");
    expect(Array.isArray(layout?.pad)).toBe(true);
  });

  it("interns paints into a colour token table the nodes refer into", () => {
    expect(Object.keys(pds.tokens.color).length).toBeGreaterThan(0);
    for (const node of Object.values(pds.nodes)) {
      if (node.fill?.startsWith("$c")) expect(pds.tokens.color[node.fill]).toBeDefined();
    }
  });

  it("interns type styles the same way", () => {
    const texts = Object.values(pds.nodes).filter((n) => n.type === "text");
    expect(texts.length).toBeGreaterThan(0);
    for (const t of texts) {
      if (t.text?.startsWith("$t")) expect(pds.tokens.text[t.text]).toBeDefined();
    }
  });

  it("carries the text content of every text node", () => {
    const texts = Object.values(pds.nodes).filter((n) => n.type === "text");
    expect(texts.every((t) => t.chars !== undefined)).toBe(true);
  });

  it("reports a node count and a token estimate a caller can budget against", () => {
    expect(pds.meta.nodeCount).toBe(Object.keys(pds.nodes).length);
    expect(pds.meta.estTokens).toBeGreaterThan(0);
  });

  it("tells the agent what to do next", () => {
    expect(pds.next.length).toBeGreaterThan(0);
  });

  it("is deterministic", () => {
    expect(normalize(file, 12)).toEqual(pds);
  });

  it("truncates at a shallow depth instead of failing", () => {
    const shallow = normalize(file, 1);
    expect(Object.keys(shallow.nodes).length).toBeLessThan(Object.keys(pds.nodes).length);
    expect(shallow.nodes[shallow.root]).toBeDefined();
  });

  it("costs fewer tokens at a shallower depth", () => {
    // The whole reason depth is a parameter.
    expect(normalize(file, 1).meta.estTokens).toBeLessThan(pds.meta.estTokens);
  });
});

describe("every consumer accepts the normalized shape", () => {
  // One normalized shape is only worth having if it is genuinely the one shape
  // everything downstream reads. Each of these would previously have needed
  // its own adapter.

  it("verify grades it against itself with no deltas", () => {
    const result = verifyAgainst(pds, pdsToRendered(pds));
    expect(result.deltas).toEqual([]);
    expect(result.unmatched).toBe(0);
  });

  it("the emit planner lowers it to a Figma plan", () => {
    const plan = lowerToEmitPlan(pds, {
      planId: "p",
      target: { kind: "page" },
      mode: "create",
    });
    const creates = plan.ops.filter((op) => op.node !== undefined);
    expect(creates.length).toBe(Object.keys(pds.nodes).length);
  });

  it("describe summarises it without a screenshot", () => {
    const described = describePds(pds);
    expect(described.root).toBe(pds.root);
    expect(described.narrative.length).toBeGreaterThan(0);
  });

  it("the design rubric grades it", () => {
    const critique = critiqueDesign(pds);
    expect(critique.dimensions).toHaveLength(6);
    expect(critique.overall).toBeGreaterThanOrEqual(0);
    expect(critique.overall).toBeLessThanOrEqual(100);
  });
});
