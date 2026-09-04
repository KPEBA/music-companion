import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    ignores: ["dist/**", "release/**", "build/**"]
  },
  {
    rules: {
      // matches the destructuring-omit convention already used to strip secrets before
      // logging/returning config objects (e.g. main.ts's publicConfig())
      "@typescript-eslint/no-unused-vars": ["error", { varsIgnorePattern: "^_", argsIgnorePattern: "^_" }],
      // defensive best-effort cleanup (e.g. player.stopVideo() during teardown) is
      // intentionally silent throughout this renderer
      "no-empty": ["error", { allowEmptyCatch: true }]
    }
  },
  {
    // main.ts, preload.ts, types.ts — Electron main process, Node context
    files: ["src/*.ts"],
    languageOptions: {
      parserOptions: {
        project: "./tsconfig.json"
      },
      globals: globals.node
    }
  },
  {
    // renderer.js — Electron renderer process, runs in a Chromium window
    files: ["src/renderer.js"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "script",
      globals: globals.browser
    }
  },
  {
    // build-time helper script, runs under plain Node via `node scripts/copy-assets.mjs`
    files: ["scripts/**/*.mjs"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: globals.node
    }
  }
);
