/**
 * Semantic Graph → audit report projection. Uses the shared envelope shape
 * from docs/ROADMAP-v0.14-design-intelligence.md §8
 * (`summary`/`findings`/`evidence`) rather than `plumb_diff`'s bespoke
 * added/removed/renamed/changed shape — a list of "here's a problem"
 * findings is exactly what that envelope was designed for, whereas diff's
 * four-bucket shape is a better fit for its own domain and wasn't worth
 * reshaping after the fact.
 */
import type { A11yFinding } from "../enrichers/accessibility";
import type { CirAnnotation } from "../graph";

export interface AuditFinding {
  category: A11yFinding["kind"];
  nodeId: string;
  detail: A11yFinding;
  note: string;
}

export interface AuditReport {
  summary: string;
  findings: AuditFinding[];
  evidence: { nodeId: string; note: string }[];
}

function noteFor(nodeId: string, value: A11yFinding): string {
  if (value.kind === "contrast") {
    return (
      `text on node "${nodeId}" has a ${value.ratio}:1 contrast ratio against its ` +
      `background (${value.foreground} on ${value.background}) — below the WCAG AA ` +
      `${value.isLargeText ? "large-text " : ""}threshold`
    );
  }
  return `node "${nodeId}" is ${value.box.w}×${value.box.h}px — below the ${value.minRequired}px minimum touch-target size`;
}

export function projectAuditReport(annotations: CirAnnotation[]): AuditReport {
  const findings: AuditFinding[] = annotations
    .filter((a): a is CirAnnotation<A11yFinding> => a.namespace === "a11y")
    .map((a) => ({ category: a.value.kind, nodeId: a.nodeId, detail: a.value, note: noteFor(a.nodeId, a.value) }));

  const contrastCount = findings.filter((f) => f.category === "contrast").length;
  const touchTargetCount = findings.filter((f) => f.category === "touchTarget").length;
  const summaryParts: string[] = [];
  if (contrastCount) summaryParts.push(`${contrastCount} contrast issue(s)`);
  if (touchTargetCount) summaryParts.push(`${touchTargetCount} touch-target issue(s)`);
  const summary = summaryParts.length
    ? `${summaryParts.join(", ")}.`
    : "No accessibility issues found by the heuristic checks run (contrast, touch-target size). " +
      "This is not a certified WCAG audit — heading-order and missing-alt checks aren't built yet.";

  return { summary, findings, evidence: findings.map((f) => ({ nodeId: f.nodeId, note: f.note })) };
}
