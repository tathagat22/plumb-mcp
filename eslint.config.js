// @ts-check
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "dist/**",
      "docs/**",
      "studio/**",
      "playground/**",
      "figma-plugin/code.js",
      "figma-plugin/ui.html",
      "node_modules/**",
      "coverage/**",
      "bench/**",
      "*.md",
    ],
  },
  tseslint.configs.recommended,
  {
    rules: {
      // Untyped/loosely-typed boundaries (MCP tool args, Figma API responses,
      // JSON.parse results) are pervasive and deliberate — this is a crash/
      // style safety net, not a type-strictness pass (that's tsc's job).
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_" }],
      "no-empty": ["warn", { allowEmptyCatch: true }],
    },
  },
);
