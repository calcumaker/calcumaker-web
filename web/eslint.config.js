// Flat config. Type-aware linting for the app sources; plain linting for the
// Node-side build/verify scripts.
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import globals from "globals";

export default tseslint.config(
  { ignores: ["dist/**", "node_modules/**", "src/wasm/*.wasm"] },

  // App sources (browser, TypeScript).
  {
    files: ["src/**/*.ts"],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    languageOptions: {
      globals: {
        ...globals.browser,
        // Injected by Vite `define` (see vite.config.ts / build-info.d.ts).
        __CM_WEB_SHA__: "readonly",
        __CM_CORE_SHA__: "readonly",
        __CM_BUILT_AT__: "readonly",
      },
    },
    rules: {
      // The WASI shim's instance type doesn't line up with the reactor we build;
      // the boundary is deliberately untyped and wrapped by Calcumaker.
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
    },
  },

  // Config + Node scripts (ESM, Node globals).
  {
    files: ["vite.config.ts", "scripts/**/*.mjs"],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    languageOptions: { globals: { ...globals.node } },
    rules: { "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }] },
  },
);
