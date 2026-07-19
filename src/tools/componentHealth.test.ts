import { describe, expect, it } from "vitest";
import type { ComponentInfo, InstanceInfo } from "../bridge/protocol";
import { buildComponentHealthReport } from "./componentHealth";

function component(partial: Partial<ComponentInfo> & { id: string; name: string }): ComponentInfo {
  return { page: "Page 1", w: 100, h: 40, instanceCount: 1, ...partial };
}

function instance(partial: Partial<InstanceInfo> & { id: string; componentId: string }): InstanceInfo {
  return { name: "Instance", page: "Page 1", ...partial };
}

describe("buildComponentHealthReport — unused components", () => {
  it("flags components with zero instances", () => {
    const components = [component({ id: "c1", name: "Button", instanceCount: 0 }), component({ id: "c2", name: "Card", instanceCount: 5 })];

    const report = buildComponentHealthReport(components, []);

    expect(report.unusedComponents).toEqual([{ id: "c1", name: "Button", page: "Page 1" }]);
  });
});

describe("buildComponentHealthReport — possible duplicates", () => {
  it("groups components whose normalized names collide", () => {
    const components = [
      component({ id: "c1", name: "Button" }),
      component({ id: "c2", name: "Button Copy" }),
      component({ id: "c3", name: "Button 2" }),
      component({ id: "c4", name: "Button (old)" }),
      component({ id: "c5", name: "Card" }),
    ];

    const report = buildComponentHealthReport(components, []);

    expect(report.possibleDuplicates).toHaveLength(1);
    expect(report.possibleDuplicates[0]?.components.map((c) => c.id).sort()).toEqual(["c1", "c2", "c3", "c4"]);
  });

  it("does not group components with genuinely distinct names", () => {
    const components = [component({ id: "c1", name: "Button" }), component({ id: "c2", name: "Card" })];

    expect(buildComponentHealthReport(components, []).possibleDuplicates).toHaveLength(0);
  });
});

describe("buildComponentHealthReport — variant outliers", () => {
  it("flags an instance whose override signature no other instance shares, among ≥3 instances", () => {
    const instances = [
      instance({ id: "i1", componentId: "c1", overrides: ["Variant=primary"] }),
      instance({ id: "i2", componentId: "c1", overrides: ["Variant=primary"] }),
      instance({ id: "i3", componentId: "c1", overrides: ["Variant=primary", "Icon=true", "Label=Weird one-off"] }),
    ];

    const report = buildComponentHealthReport([], instances);

    expect(report.variantOutliers).toHaveLength(1);
    expect(report.variantOutliers[0]?.instanceId).toBe("i3");
  });

  it("does not flag anything when a component has fewer than 3 instances", () => {
    const instances = [
      instance({ id: "i1", componentId: "c1", overrides: ["A"] }),
      instance({ id: "i2", componentId: "c1", overrides: ["B"] }),
    ];

    expect(buildComponentHealthReport([], instances).variantOutliers).toHaveLength(0);
  });

  it("never flags instances with no overrides, even as the only default instance", () => {
    const instances = [
      instance({ id: "i1", componentId: "c1", overrides: ["Variant=primary"] }),
      instance({ id: "i2", componentId: "c1", overrides: ["Variant=primary"] }),
      instance({ id: "i3", componentId: "c1", overrides: [] }),
    ];

    expect(buildComponentHealthReport([], instances).variantOutliers).toHaveLength(0);
  });
});

describe("buildComponentHealthReport — summary", () => {
  it("reports a clean summary when nothing is flagged", () => {
    const report = buildComponentHealthReport([component({ id: "c1", name: "Button", instanceCount: 3 })], []);

    expect(report.summary).toBe("No design-system health issues found by these heuristics.");
  });

  it("combines counts from all three checks into one summary line", () => {
    const components = [component({ id: "c1", name: "Unused", instanceCount: 0 })];
    const instances = [
      instance({ id: "i1", componentId: "c2", overrides: ["A"] }),
      instance({ id: "i2", componentId: "c2", overrides: ["A"] }),
      instance({ id: "i3", componentId: "c2", overrides: ["B", "C"] }),
    ];

    const report = buildComponentHealthReport(components, instances);

    expect(report.summary).toBe("1 unused component(s), 1 one-off variant override(s).");
  });
});
