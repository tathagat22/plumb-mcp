import { defineConfig } from "tsup";

// Milestone 0: bundle the stdio MCP server to a single npx-runnable entry.
export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  target: "node20",
  clean: true,
  dts: false,
  sourcemap: false,
  minify: false,
  // The bin entry needs a shebang; esbuild strips one written in source.
  banner: { js: "#!/usr/bin/env node" },
});
