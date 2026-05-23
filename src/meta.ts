/** Server identity — kept in its own module so tools can import it without
 *  forming an import cycle through server.ts.
 *
 *  The version is read from package.json at runtime so there's a single
 *  source of truth across npm, the README, the docs site, and `--version`.
 *  Previously this drifted on every release. */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

interface PackageMeta { name?: string; version?: string }

function loadPackageMeta(): PackageMeta {
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    // dist/index.js lives at the package root's dist/. package.json is at ../.
    const pkgPath = join(here, "..", "package.json");
    return JSON.parse(readFileSync(pkgPath, "utf8")) as PackageMeta;
  } catch {
    return {};
  }
}

const pkg = loadPackageMeta();

export const SERVER_NAME: string = pkg.name ?? "plumb-mcp";
export const SERVER_VERSION: string = pkg.version ?? "0.0.0";
