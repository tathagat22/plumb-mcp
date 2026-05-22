/**
 * Mints the stable `el` handle for a node (plan §6.5 / §14).
 *
 * M0 scheme: `slug(name)`, with a numeric suffix on collision, assigned in
 * deterministic DFS order. Figma node `id`s are already stable across edits,
 * so `el` only needs to be a readable alias — M1 will persist the
 * `figmaId → el` mapping in the version cache so handles survive renames.
 */
export class HandleMinter {
  private readonly used = new Set<string>();

  mint(name: string, type: string): string {
    const base = slug(name) || slug(type) || "node";
    let el = base;
    let n = 2;
    while (this.used.has(el)) el = `${base}-${n++}`;
    this.used.add(el);
    return el;
  }
}

function slug(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/g, "");
}
