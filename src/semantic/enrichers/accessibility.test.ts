import { describe, expect, it } from "vitest";
import type { CirAnnotation, CirNode, SemanticGraph } from "../graph";
import { AccessibilityEnricher } from "./accessibility";
import type { A11yFinding } from "./accessibility";

let nextId = 0;

function node(partial: Partial<CirNode> & { kind: CirNode["kind"] }): CirNode {
  const id = partial.id ?? `n${nextId++}`;
  return {
    id,
    box: { w: 100, h: 100 },
    children: [],
    style: {},
    sourceRef: { adapter: "figma", nativeId: id },
    ...partial,
  };
}

function graph(root: CirNode, all: CirNode[]): SemanticGraph {
  const nodes: Record<string, CirNode> = {};
  for (const n of all) nodes[n.id] = n;
  nodes[root.id] = root;
  return { cirVersion: "1.0.0", root: root.id, nodes, edges: [] };
}

function findingsOf(annotations: CirAnnotation[], kind: A11yFinding["kind"]): CirAnnotation[] {
  return annotations.filter((a) => (a.value as A11yFinding).kind === kind);
}

describe("AccessibilityEnricher — contrast", () => {
  it("flags low-contrast text against an ancestor's resolved background", () => {
    const text = node({ id: "label", kind: "text", style: { fillColor: "#777777", textPx: 14 } });
    const bg = node({ id: "bg", kind: "container", style: { fillColor: "#666666" }, children: ["label"] });
    const g = graph(bg, [text]);

    const findings = findingsOf(AccessibilityEnricher.run(g, []), "contrast");

    expect(findings).toHaveLength(1);
    expect((findings[0]?.value as A11yFinding & { kind: "contrast" }).level).toBe("fail");
  });

  it("does not flag high-contrast text", () => {
    const text = node({ id: "label", kind: "text", style: { fillColor: "#000000", textPx: 14 } });
    const bg = node({ id: "bg", kind: "container", style: { fillColor: "#ffffff" }, children: ["label"] });
    const g = graph(bg, [text]);

    expect(findingsOf(AccessibilityEnricher.run(g, []), "contrast")).toHaveLength(0);
  });

  it("applies the relaxed large-text threshold (a ratio that clears 3.0 but not 4.5 passes only when large)", () => {
    // #888888 on #ffffff is ~3.5:1 — fails the 4.5:1 normal-text AA
    // threshold but clears the 3.0:1 large-text one.
    const smallText = node({ id: "small", kind: "text", style: { fillColor: "#888888", textPx: 14 } });
    const largeText = node({ id: "large", kind: "text", style: { fillColor: "#888888", textPx: 32 } });
    const bg = node({ id: "bg", kind: "container", style: { fillColor: "#ffffff" }, children: ["small", "large"] });
    const g = graph(bg, [smallText, largeText]);

    const findings = findingsOf(AccessibilityEnricher.run(g, []), "contrast");

    expect(findings.map((f) => f.nodeId)).toEqual(["small"]);
  });

  it("abstains when no ancestor background resolves to a solid color", () => {
    const text = node({ id: "label", kind: "text", style: { fillColor: "#777777", textPx: 14 } });
    const bg = node({ id: "bg", kind: "container", children: ["label"] }); // no fillColor anywhere
    const g = graph(bg, [text]);

    expect(findingsOf(AccessibilityEnricher.run(g, []), "contrast")).toHaveLength(0);
  });
});

describe("AccessibilityEnricher — touch targets", () => {
  it("flags a role:button node under the 44x44 minimum", () => {
    const small = node({ id: "btn", kind: "container", box: { w: 30, h: 30 } });
    const root = node({ id: "root", kind: "container", children: ["btn"] });
    const g = graph(root, [small]);
    const priorAnnotations: CirAnnotation[] = [{ nodeId: "btn", namespace: "role", version: "1.0.0", value: "button" }];

    const findings = findingsOf(AccessibilityEnricher.run(g, priorAnnotations), "touchTarget");

    expect(findings).toHaveLength(1);
    expect(findings[0]?.nodeId).toBe("btn");
  });

  it("does not flag a role:button node at or above the minimum", () => {
    const big = node({ id: "btn", kind: "container", box: { w: 120, h: 44 } });
    const root = node({ id: "root", kind: "container", children: ["btn"] });
    const g = graph(root, [big]);
    const priorAnnotations: CirAnnotation[] = [{ nodeId: "btn", namespace: "role", version: "1.0.0", value: "button" }];

    expect(findingsOf(AccessibilityEnricher.run(g, priorAnnotations), "touchTarget")).toHaveLength(0);
  });

  it("ignores non-button roles", () => {
    const small = node({ id: "nav", kind: "container", box: { w: 20, h: 20 } });
    const root = node({ id: "root", kind: "container", children: ["nav"] });
    const g = graph(root, [small]);
    const priorAnnotations: CirAnnotation[] = [{ nodeId: "nav", namespace: "role", version: "1.0.0", value: "nav" }];

    expect(findingsOf(AccessibilityEnricher.run(g, priorAnnotations), "touchTarget")).toHaveLength(0);
  });
});
