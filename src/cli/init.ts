import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

interface EditorTarget {
  name: string;
  /** Paths whose existence implies the editor is installed. */
  detect: string[];
  /** Where the MCP config is written. */
  configFile: string;
  /** Some editors key the block `servers`, others `mcpServers`. */
  key: "mcpServers" | "servers";
}

function targets(cwd: string): EditorTarget[] {
  const home = homedir();
  return [
    {
      name: "Claude Code",
      detect: [join(home, ".claude"), join(home, ".claude.json")],
      configFile: join(cwd, ".mcp.json"),
      key: "mcpServers",
    },
    {
      name: "Cursor",
      detect: [join(home, ".cursor")],
      configFile: join(cwd, ".cursor", "mcp.json"),
      key: "mcpServers",
    },
    {
      name: "VS Code",
      detect: [
        join(home, ".vscode"),
        join(home, "Library", "Application Support", "Code"),
      ],
      configFile: join(cwd, ".vscode", "mcp.json"),
      key: "servers",
    },
    {
      name: "Windsurf",
      detect: [join(home, ".codeium", "windsurf")],
      configFile: join(home, ".codeium", "windsurf", "mcp_config.json"),
      key: "mcpServers",
    },
  ];
}

/** Merge the Plumb server entry into an editor's config without clobbering it. */
function mergeConfig(file: string, key: string, entry: unknown): void {
  let config: Record<string, unknown> = {};
  if (existsSync(file)) {
    try {
      config = JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
    } catch {
      config = {};
    }
  }
  const servers = (config[key] as Record<string, unknown>) ?? {};
  servers.plumb = entry;
  config[key] = servers;
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(config, null, 2) + "\n");
}

/**
 * `plumb-mcp init` — detect installed editors and write the correct MCP config
 * for each (plan §7 / §9). Project-scoped files for Claude Code / Cursor /
 * VS Code; the global config for Windsurf.
 */
export function runInit(): void {
  const cwd = process.cwd();
  const entry = fileURLToPath(import.meta.url); // abs path to the built dist/index.js
  const pkgRoot = dirname(dirname(entry)); // the Plumb package root (dist/ is one level down)
  const token = process.env.FIGMA_TOKEN ?? "figd_your_read_only_token";
  const serverEntry = { command: "node", args: [entry], env: { FIGMA_TOKEN: token } };

  const out: string[] = ["", "Plumb · init", "─".repeat(58)];
  let wrote = 0;

  for (const t of targets(cwd)) {
    if (t.detect.some((p) => existsSync(p))) {
      mergeConfig(t.configFile, t.key, serverEntry);
      out.push(`  ✓ ${t.name.padEnd(13)}→ ${t.configFile}`);
      wrote += 1;
    } else {
      out.push(`  · ${t.name.padEnd(13)}  not detected (skipped)`);
    }
  }

  out.push("─".repeat(58));
  if (wrote === 0) {
    out.push("No supported editor detected. Add this to your MCP client config:");
    out.push(JSON.stringify({ mcpServers: { plumb: serverEntry } }, null, 2));
  }
  if (!process.env.FIGMA_TOKEN) {
    out.push(
      "",
      "⚠ FIGMA_TOKEN was written as a placeholder. The REST tools need a real",
      "  read-only token (figma.com → Settings → Security). The plugin path",
      "  needs no token — see below.",
    );
  }
  out.push(
    "",
    "Figma plugin (plugin path — no token, no rate limits):",
    "  Figma desktop → Plugins → Development → Import plugin from manifest",
    `  → ${join(pkgRoot, "figma-plugin", "manifest.json")}`,
    "",
    "Restart your editor to load the Plumb MCP server.",
    "",
  );

  process.stdout.write(out.join("\n"));
}
