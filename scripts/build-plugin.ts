/** Builds the Figma plugin's main thread: figma-plugin/code.ts → code.js. */
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

await build({
  entryPoints: [join(root, "figma-plugin", "code.ts")],
  outfile: join(root, "figma-plugin", "code.js"),
  bundle: true,
  format: "iife",
  target: "es2017",
  logLevel: "warning",
});

console.log("✓ built figma-plugin/code.js");
