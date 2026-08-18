/**
 * Telling design *content* apart from design *fidelity*.
 *
 * A wrong colour is always a bug. A wrong string usually isn't — the agent is
 * supposed to drop real content into the design's placeholder slots. These
 * helpers decide which strings are filler (copy-pasted template cells, lorem,
 * generic labels, numeric stubs), so a content swap there stays advisory
 * instead of denting the fit score.
 */

import type { PdsDocument } from "../pds";

/**
 * Collect every trimmed string `chars` value the design repeats ≥3 times. These
 * are copy-pasted template cells (table rows, list items, card stacks the
 * designer duplicated to show layout) — content the build legitimately replaces.
 */
export function collectDuplicateChars(pds: PdsDocument): Set<string> {
  const counts = new Map<string, number>();
  for (const el of Object.keys(pds.nodes)) {
    const node = pds.nodes[el];
    if (!node || typeof node.chars !== "string") continue;
    const t = node.chars.trim();
    if (!t) continue;
    counts.set(t, (counts.get(t) ?? 0) + 1);
  }
  const dup = new Set<string>();
  for (const [s, n] of counts) if (n >= 3) dup.add(s);
  return dup;
}

/** Generic structural stand-ins designers type into a mockup, lowercased. */
const PLACEHOLDER_LABELS = new Set([
  "title",
  "subtitle",
  "heading",
  "subheading",
  "header",
  "body",
  "body text",
  "text",
  "label",
  "caption",
  "description",
  "placeholder",
  "content",
  "lorem ipsum",
  "name",
  "first name",
  "last name",
  "full name",
  "your name",
  "email",
  "email address",
  "username",
  "company name",
  "address",
]);

/**
 * True when an expected string is template filler rather than meaningful copy —
 * so a content swap there is expected, not a fidelity bug. Conservative on
 * purpose: real UI labels ("Save", "Dashboard", "Get started") must NOT match
 * here, or genuine wrong-label bugs would be silenced.
 */
export function isPlaceholderText(s: string, isDuplicate: boolean): boolean {
  if (isDuplicate) return true; // copy-pasted across the design → filler
  const t = s.trim();
  if (t === "") return true;
  const low = t.toLowerCase();
  if (PLACEHOLDER_LABELS.has(low)) return true;
  if (/lorem ipsum|\bdummy\b|\bplaceholder\b|sample text/i.test(t)) return true;
  // Long body copy is filler the agent rewrites with real content.
  if (t.length > 60) return true;
  // A single character repeated (xxx, •••, ———, ...).
  if (/^(.)\1{2,}$/.test(t)) return true;
  // Numeric / currency / time stubs ($0.00, 1,234, 00:00, 12%, 0 / 0). The
  // digit guard is deliberate: a bare "-" or "—" is a real label often enough
  // that treating it as filler would cost more than it saves.
  if (/\d/.test(t) && /^[\s$€£₹%.,:+\-–—()0-9/]+$/.test(t)) return true;
  return false;
}
