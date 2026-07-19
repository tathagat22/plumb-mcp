/**
 * Semantic Graph → PDS projection. Merges annotation sources back onto the
 * wire-format `PdsNode.pattern` field for backward compatibility with every
 * existing caller (`plumb_node` / `plumb_outline` / `plumb_query`) — no
 * protocol change, byte-identical shape to the pre-refactor output.
 *
 * `pattern` currently has two independent producers that both write the
 * same wire field: the leaf-level `"button"` detector (`inferPattern` in
 * `src/normalize/normalize.ts`, still runs inline during the parse walk —
 * deliberately NOT migrated in this milestone, see the roadmap doc M2 scope
 * note) and this projection's `role` annotations. This function is where
 * that merge happens; it never overwrites a value `inferPattern` already
 * set, matching the "never clobber an existing pattern" rule both
 * producers have always followed.
 */
import type { CirAnnotation } from "../graph";
import type { PdsDocument } from "../../pds";

export function projectRoleOntoPds(doc: PdsDocument, annotations: CirAnnotation[]): void {
  for (const a of annotations) {
    if (a.namespace !== "role" || typeof a.value !== "string") continue;
    const node = doc.nodes[a.nodeId];
    if (node && !node.pattern) node.pattern = a.value;
  }
}
