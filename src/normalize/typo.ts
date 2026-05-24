import type { PdsNode, SuspiciousText } from "../pds";

/**
 * Capped Levenshtein distance. Returns max+1 if the true distance exceeds max,
 * which lets the caller bail early without computing the full DP table.
 */
function editDistance(a: string, b: string, max: number): number {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > max) return max + 1;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  let prev: number[] = new Array<number>(b.length + 1).fill(0);
  let cur: number[] = new Array<number>(b.length + 1).fill(0);
  for (let j = 0; j <= b.length; j++) prev[j] = j;

  for (let i = 1; i <= a.length; i++) {
    cur[0] = i;
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      const v = Math.min(prev[j]! + 1, cur[j - 1]! + 1, prev[j - 1]! + cost);
      cur[j] = v;
      if (v < rowMin) rowMin = v;
    }
    if (rowMin > max) return max + 1;
    [prev, cur] = [cur, prev];
  }
  return prev[b.length]!;
}

/**
 * Flag TEXT nodes whose chars look like a typo of a sibling/cluster value.
 *
 * Heuristic: a candidate is suspicious if its `chars` appears exactly once
 * in the whole subtree AND some other string appears ≥3 times AND the edit
 * distance between them is 1 or 2. Below that minimum cluster size we'd
 * generate false positives on prose (every paragraph differs by >2 edits
 * from everything else, but headings legitimately differ from labels by 1).
 *
 * Compares against the most-frequent near-match so the hint cites it.
 */
export function detectSuspiciousText(
  nodes: Record<string, PdsNode>,
): SuspiciousText[] {
  const items: Array<{ path: string; chars: string }> = [];
  for (const el in nodes) {
    const n = nodes[el];
    if (!n || n.type !== "text") continue;
    const chars = typeof n.chars === "string" ? n.chars.trim() : "";
    if (!chars) continue;
    items.push({ path: n.path ?? n.el, chars });
  }
  if (items.length < 4) return [];

  const freq = new Map<string, number>();
  for (const t of items) freq.set(t.chars, (freq.get(t.chars) ?? 0) + 1);

  const out: SuspiciousText[] = [];
  for (const t of items) {
    if ((freq.get(t.chars) ?? 0) !== 1) continue; // not an outlier

    let bestMatch: { chars: string; count: number } | undefined;
    for (const [other, count] of freq) {
      if (other === t.chars) continue;
      if (count < 3) continue;
      const max = t.chars.length > 12 ? 2 : 1;
      const d = editDistance(t.chars, other, max);
      if (d > 0 && d <= max) {
        if (!bestMatch || count > bestMatch.count) {
          bestMatch = { chars: other, count };
        }
      }
    }

    if (bestMatch) {
      out.push({
        path: t.path,
        value: t.chars,
        hint: `Possible typo: "${bestMatch.chars}" appears ${bestMatch.count}× nearby`,
      });
    }
  }
  return out;
}
