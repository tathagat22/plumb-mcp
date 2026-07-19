/**
 * Design-system health report — docs/ROADMAP-v0.14-design-intelligence.md
 * §10 M5. Pure, operating on the same `ComponentInfo`/`InstanceInfo` data
 * `plumb_components` already fetches from the plugin bridge (see
 * `src/bridge/protocol.ts`) — deliberately NOT part of the Semantic Graph
 * (`src/semantic/*`). That pipeline exists for PDS/`PdsNode`-shaped data;
 * component/instance metadata comes from a different bridge call entirely
 * and doesn't need a CIR to reason about — reaching for the semantic layer
 * here would have been exactly the kind of "every layer has exactly one
 * job" violation this whole roadmap is trying to avoid.
 *
 * Three cheap, real checks — everything derivable from data Plumb already
 * has, no new fetches:
 *  - unused components: `instanceCount === 0`, already a field.
 *  - possible duplicates: components whose name, once stripped of the
 *    usual "this is actually the same thing" noise (" copy", "(old)",
 *    trailing digits), collides with another component's. A name heuristic,
 *    not a structural one — real structural duplicate detection would need
 *    to fetch and fingerprint every component's full node tree (N more
 *    calls), judged too expensive for a v1. Named here as a real gap, not
 *    silently absent.
 *  - variant outliers: instances whose override signature doesn't match
 *    any other instance of the same component, among components with
 *    enough instances (≥3) for "everyone else does X" to mean something —
 *    a proxy for ad-hoc one-off customization rather than an intentional
 *    variant.
 */
import type { ComponentInfo, InstanceInfo } from "../bridge/protocol";

export interface DuplicateGroup {
  normalizedName: string;
  components: { id: string; name: string; page: string }[];
}

export interface VariantOutlier {
  componentId: string;
  instanceId: string;
  instanceName: string;
  overrides: string[];
}

export interface ComponentHealthReport {
  unusedComponents: { id: string; name: string; page: string }[];
  possibleDuplicates: DuplicateGroup[];
  variantOutliers: VariantOutlier[];
  summary: string;
}

const MIN_INSTANCES_FOR_VARIANT_CHECK = 3;

function normalizeComponentName(name: string): string {
  return name
    .toLowerCase()
    .replace(/\(.*?\)/g, " ") // parenthetical suffixes: "(old)", "(deprecated)"
    .replace(/\bcopy\b/g, " ")
    .replace(/\d+$/, " ") // trailing digits: "Button 2"
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function overrideSignature(overrides: string[] | undefined): string {
  return (overrides ?? []).slice().sort().join("|");
}

export function buildComponentHealthReport(
  components: ComponentInfo[],
  instances: InstanceInfo[],
): ComponentHealthReport {
  const unusedComponents = components
    .filter((c) => c.instanceCount === 0)
    .map((c) => ({ id: c.id, name: c.name, page: c.page }));

  const byNormalizedName = new Map<string, ComponentInfo[]>();
  for (const c of components) {
    const key = normalizeComponentName(c.name);
    if (!key) continue;
    const bucket = byNormalizedName.get(key);
    if (bucket) bucket.push(c);
    else byNormalizedName.set(key, [c]);
  }
  const possibleDuplicates: DuplicateGroup[] = [...byNormalizedName.entries()]
    .filter(([, group]) => group.length > 1)
    .map(([normalizedName, group]) => ({
      normalizedName,
      components: group.map((c) => ({ id: c.id, name: c.name, page: c.page })),
    }));

  const instancesByComponent = new Map<string, InstanceInfo[]>();
  for (const i of instances) {
    const bucket = instancesByComponent.get(i.componentId);
    if (bucket) bucket.push(i);
    else instancesByComponent.set(i.componentId, [i]);
  }
  const variantOutliers: VariantOutlier[] = [];
  for (const [componentId, group] of instancesByComponent) {
    if (group.length < MIN_INSTANCES_FOR_VARIANT_CHECK) continue;
    const signatureCounts = new Map<string, number>();
    for (const inst of group) {
      const sig = overrideSignature(inst.overrides);
      signatureCounts.set(sig, (signatureCounts.get(sig) ?? 0) + 1);
    }
    for (const inst of group) {
      const sig = overrideSignature(inst.overrides);
      // Empty signature (no overrides — using defaults) is never an
      // outlier, even if it happens to be the only default-only instance.
      if (sig && signatureCounts.get(sig) === 1) {
        variantOutliers.push({ componentId, instanceId: inst.id, instanceName: inst.name, overrides: inst.overrides ?? [] });
      }
    }
  }

  const parts: string[] = [];
  if (unusedComponents.length) parts.push(`${unusedComponents.length} unused component(s)`);
  if (possibleDuplicates.length) parts.push(`${possibleDuplicates.length} possible duplicate group(s)`);
  if (variantOutliers.length) parts.push(`${variantOutliers.length} one-off variant override(s)`);
  const summary = parts.length
    ? `${parts.join(", ")}.`
    : "No design-system health issues found by these heuristics.";

  return { unusedComponents, possibleDuplicates, variantOutliers, summary };
}
