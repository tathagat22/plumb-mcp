import { effectsToCss, paintToCss, typeStyleToCss } from "./paint";
import type { FigmaEffect, FigmaPaint, FigmaTypeStyle } from "../figma/types";
import type { Effect, Fill, PdsLayout, TokenTable } from "../pds";

/**
 * Dedup-by-reference (plan §5). A design file repeats the same fill / type /
 * radius / shadow hundreds of times; the interner extracts each distinct value
 * once and hands back a short, stable `$id`. Ids are assigned in first-seen
 * (deterministic DFS) order, so the same file always yields the same table.
 *
 * v0.10 — Phase 1 extends interning from the four atomic namespaces (color,
 * text, radius, shadow) to compound structured values: full layout objects,
 * effect stacks, fill stacks, vector paths, and component prop maps. These
 * repeat just as aggressively across a screen as colors do — a list with
 * 20 rows ships 20 identical layout objects today, 1 + 20 refs tomorrow.
 */
export class TokenInterner {
  private readonly color = new Map<string, string>();
  private readonly text = new Map<string, string>();
  private readonly radius = new Map<string, string>();
  private readonly shadow = new Map<string, string>();
  // Compound namespaces (v0.10).
  private readonly layout = new Map<string, string>();
  private readonly effects = new Map<string, string>();
  private readonly fills = new Map<string, string>();
  private readonly vector = new Map<string, string>();
  private readonly props = new Map<string, string>();
  // Per-ref hit count — surfaced as tokens.meta.counts so agents can see
  // "$l1 used 23×" as concrete proof of the dedup. Cheap; ~one int per ref.
  private readonly counts = new Map<string, number>();

  internColor(paints: FigmaPaint[] | undefined): string | undefined {
    const v = paintToCss(paints);
    return v === undefined ? undefined : this.intern(this.color, "c", v);
  }

  internText(style: FigmaTypeStyle | undefined): string | undefined {
    const v = typeStyleToCss(style);
    return v === undefined ? undefined : this.intern(this.text, "t", v);
  }

  internRadius(r: number | "full" | undefined): string | undefined {
    if (r === undefined) return undefined;
    if (r === "full") return this.intern(this.radius, "r", "full");
    if (r <= 0) return undefined;
    return this.intern(this.radius, "r", String(r));
  }

  internShadow(effects: FigmaEffect[] | undefined): string | undefined {
    const v = effectsToCss(effects);
    return v === undefined ? undefined : this.intern(this.shadow, "s", v);
  }

  /** Intern a full PdsLayout object — fires per auto-layout container. */
  internLayout(layout: PdsLayout | undefined): string | undefined {
    if (!layout) return undefined;
    return this.intern(this.layout, "l", stableStringify(layout));
  }

  /** Intern an effects stack — fires on multi-shadow / blur surfaces. */
  internEffects(stack: Effect[] | undefined): string | undefined {
    if (!stack || stack.length === 0) return undefined;
    return this.intern(this.effects, "e", stableStringify(stack));
  }

  /** Intern a full fills stack — gradients, layered solids, image fills. */
  internFills(stack: Fill[] | undefined): string | undefined {
    if (!stack || stack.length === 0) return undefined;
    return this.intern(this.fills, "f", stableStringify(stack));
  }

  /** Intern a vector path `d` string — fires on every drawn icon. */
  internVector(path: string | undefined): string | undefined {
    if (!path) return undefined;
    return this.intern(this.vector, "v", path);
  }

  /** Intern a component-instance prop map. */
  internProps(
    props: Record<string, string | boolean | number> | undefined,
  ): string | undefined {
    if (!props || Object.keys(props).length === 0) return undefined;
    return this.intern(this.props, "p", stableStringify(props));
  }

  private intern(map: Map<string, string>, prefix: string, value: string): string {
    const existing = map.get(value);
    if (existing) {
      this.counts.set(existing, (this.counts.get(existing) ?? 1) + 1);
      return existing;
    }
    const id = `$${prefix}${map.size + 1}`;
    map.set(value, id);
    this.counts.set(id, 1);
    return id;
  }

  table(): TokenTable {
    const out: TokenTable = {
      color: invert(this.color),
      text: invert(this.text),
      radius: Object.fromEntries(
        [...this.radius].map(([value, id]) => [
          id,
          value === "full" ? "full" : Number(value),
        ] as [string, number | "full"]),
      ),
      shadow: invert(this.shadow),
    };
    // Compound namespaces — only emit when non-empty so v0.9-shaped responses
    // don't grow an empty `layout: {}` block on screens with no auto-layout.
    if (this.layout.size > 0) out.layout = parseInvert<PdsLayout>(this.layout);
    if (this.effects.size > 0) out.effects = parseInvert<Effect[]>(this.effects);
    if (this.fills.size > 0) out.fills = parseInvert<Fill[]>(this.fills);
    if (this.vector.size > 0) out.vector = invert(this.vector);
    if (this.props.size > 0) {
      out.props = parseInvert<Record<string, string | boolean | number>>(this.props);
    }
    // Hit counts — proof of dedup. Only refs with ≥2 uses are interesting;
    // singletons are noise.
    const counts: Record<string, number> = {};
    for (const [id, n] of this.counts) if (n >= 2) counts[id] = n;
    if (Object.keys(counts).length > 0) out.meta = { counts };
    return out;
  }
}

/** Map<value, $id> → Record<$id, value>. */
function invert(map: Map<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [value, id] of map) out[id] = value;
  return out;
}

/** Same as invert, but parses the value back from its JSON shape. */
function parseInvert<T>(map: Map<string, string>): Record<string, T> {
  const out: Record<string, T> = {};
  for (const [value, id] of map) out[id] = JSON.parse(value) as T;
  return out;
}

/**
 * JSON.stringify with deterministically-sorted object keys. Two layouts that
 * differ only in key order ({flow,gap} vs {gap,flow}) must intern to the same
 * id, or the dedup misses every other instance. Arrays preserve order.
 */
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map((v) => stableStringify(v)).join(",")}]`;
  }
  const keys = Object.keys(value as Record<string, unknown>).sort();
  const parts = keys.map(
    (k) => `${JSON.stringify(k)}:${stableStringify((value as Record<string, unknown>)[k])}`,
  );
  return `{${parts.join(",")}}`;
}
