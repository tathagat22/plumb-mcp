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
      // `_`-prefixed names are deliberate discards; `ignoreRestSiblings` covers
      // the `const { drop, ...rest } = obj` idiom for omitting a key.
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", ignoreRestSiblings: true },
      ],
      "no-empty": ["warn", { allowEmptyCatch: true }],

      // Enforced ceiling on file size, counting code only — this codebase is
      // comment-dense on purpose and a long explanation is not the problem a
      // size cap exists to catch.
      //
      // 600 is a real limit, not an aspiration: the five 1000+ LOC files that
      // used to live here (figma-plugin/code.ts, src/normalize/normalize.ts,
      // src/dsl/schema.ts, figma-plugin/emit.ts, src/verify.ts) are all split
      // now, and this is what stops them growing back. Hitting it means
      // extracting a module, not raising the number.
      "max-lines": [
        "error",
        { max: 600, skipBlankLines: true, skipComments: true },
      ],
    },
  },
  {
    // Test files earn more room: a table-driven spec is mostly data, and
    // splitting one to satisfy a line count makes the suite harder to read,
    // not easier.
    files: ["**/*.test.ts"],
    rules: { "max-lines": "off" },
  },
);
