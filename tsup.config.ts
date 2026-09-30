import { defineConfig } from "tsup";

// Milestone 0: bundle the stdio MCP server to a single npx-runnable entry.
export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  target: "node20",
  clean: true,
  dts: false,
  sourcemap: false,
  // Strip whitespace and comments but keep identifiers, so stack traces stay
  // readable. The comments carry em-dashes and arrows; one non-Latin-1 char
  // makes V8 hold the whole bundle source as two-byte text, doubling it.
  minify: false,
  esbuildOptions(options) {
    options.minifyWhitespace = true;
    options.minifySyntax = true;
    options.charset = "ascii";
  },
  // The bin entry needs a shebang; esbuild strips one written in source.
  banner: { js: "#!/usr/bin/env node" },
});
