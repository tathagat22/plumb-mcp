import { effectsToCss, paintToCss, typeStyleToCss } from "./paint";
import type { FigmaEffect, FigmaPaint, FigmaTypeStyle } from "../figma/types";
import type { TokenTable } from "../pds";

/**
 * Dedup-by-reference (plan §5). A design file repeats the same fill / type /
 * radius / shadow hundreds of times; the interner extracts each distinct value
 * once and hands back a short, stable `$id`. Ids are assigned in first-seen
 * (deterministic DFS) order, so the same file always yields the same table.
 */
export class TokenInterner {
  private readonly color = new Map<string, string>();
  private readonly text = new Map<string, string>();
  private readonly radius = new Map<string, string>();
  private readonly shadow = new Map<string, string>();

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

  private intern(map: Map<string, string>, prefix: string, value: string): string {
    const existing = map.get(value);
    if (existing) return existing;
    const id = `$${prefix}${map.size + 1}`;
    map.set(value, id);
    return id;
  }

  table(): TokenTable {
    return {
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
  }
}

/** Map<value, $id> → Record<$id, value>. */
function invert(map: Map<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [value, id] of map) out[id] = value;
  return out;
}
