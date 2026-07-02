/**
 * One-command dev loop: watches BOTH the MCP server (src → dist, via tsup) and
 * the Figma plugin (figma-plugin/code.ts → code.js, via esbuild) and rebuilds on
 * every save. No manual `npm run build` needed.
 *
 * After a rebuild you still refresh the two live runtimes yourself (they own
 * their own process lifecycle — nothing can hot-swap them from here):
 *   • changed something under src/       → reconnect the MCP server (Claude Code: /mcp → plumb → Reconnect)
 *   • changed something under figma-plugin/ → re-run the plugin in Figma (macOS: Cmd+Option+P runs the last plugin)
 * The banner below prints which one to refresh after each rebuild.
 */
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { context } from "esbuild";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

// --- Plugin watcher (esbuild) ------------------------------------------------
const pluginCtx = await context({
  entryPoints: [join(root, "figma-plugin", "code.ts")],
  outfile: join(root, "figma-plugin", "code.js"),
  bundle: true,
  format: "iife",
  target: "es2017",
  logLevel: "silent",
  plugins: [
    {
      name: "plumb-plugin-reload-banner",
      setup(build) {
        build.onEnd((r) => {
          if (r.errors.length) {
            console.error(`✗ plugin build failed (${r.errors.length} error/s)`);
          } else {
            console.log("✓ figma-plugin/code.js rebuilt → RE-RUN the plugin in Figma (Cmd+Option+P)");
          }
        });
      },
    },
  ],
});
await pluginCtx.watch();

// --- Server watcher (tsup --watch) -------------------------------------------
// tsup prints its own rebuild lines; the reminder below covers the refresh step.
const tsup = spawn("npx", ["tsup", "--watch"], { cwd: root, stdio: "inherit", shell: true });

console.log("▶ Plumb dev: watching src/ (server) + figma-plugin/ (plugin). Ctrl-C to stop.");
console.log("   src/ change        → /mcp → plumb → Reconnect");
console.log("   figma-plugin/ change → re-run plugin in Figma (Cmd+Option+P)");

function shutdown(): void {
  void pluginCtx.dispose();
  tsup.kill();
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
