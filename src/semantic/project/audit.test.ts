import { describe, expect, it } from "vitest";
import type { CirAnnotation } from "../graph";
import { projectAuditReport } from "./audit";

describe("projectAuditReport", () => {
  it("returns a clean summary and no findings when there are no a11y annotations", () => {
    const report = projectAuditReport([]);

    expect(report.findings).toHaveLength(0);
    expect(report.summary).toContain("No accessibility issues found");
  });

  it("ignores annotations from other namespaces", () => {
    const annotations: CirAnnotation[] = [{ nodeId: "n1", namespace: "role", version: "1.0.0", value: "hero" }];

    expect(projectAuditReport(annotations).findings).toHaveLength(0);
  });

  it("formats a contrast finding's note and rolls it into the summary count", () => {
    const annotations: CirAnnotation[] = [
      {
        nodeId: "label",
        namespace: "a11y",
        version: "1.0.0",
        value: { kind: "contrast", ratio: 2.1, level: "fail", foreground: "#777777", background: "#666666", isLargeText: false },
      },
    ];

    const report = projectAuditReport(annotations);

    expect(report.findings).toHaveLength(1);
    expect(report.findings[0]?.note).toContain("2.1:1");
    expect(report.summary).toBe("1 contrast issue(s).");
    expect(report.evidence).toEqual([{ nodeId: "label", note: report.findings[0]?.note }]);
  });

  it("formats a touch-target finding's note and combines counts across both categories", () => {
    const annotations: CirAnnotation[] = [
      {
        nodeId: "label",
        namespace: "a11y",
        version: "1.0.0",
        value: { kind: "contrast", ratio: 2.1, level: "fail", foreground: "#777777", background: "#666666", isLargeText: false },
      },
      {
        nodeId: "btn",
        namespace: "a11y",
        version: "1.0.0",
        value: { kind: "touchTarget", box: { w: 20, h: 20 }, minRequired: 44 },
      },
    ];

    const report = projectAuditReport(annotations);

    expect(report.findings).toHaveLength(2);
    expect(report.findings.find((f) => f.nodeId === "btn")?.note).toContain("20×20px");
    expect(report.summary).toBe("1 contrast issue(s), 1 touch-target issue(s).");
  });
});
