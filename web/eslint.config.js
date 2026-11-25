import js from "@eslint/js";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["dist", "dist-visual", "test-results", "playwright-report", "node_modules"] },
  {
    files: ["**/*.{ts,tsx}"],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    languageOptions: { ecmaVersion: 2022, globals: { ...globals.browser, ...globals.node } },
    plugins: { "react-hooks": reactHooks, "react-refresh": reactRefresh },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "react-refresh/only-export-components": ["warn", { allowConstantExport: true }],
      // Regra de segurança: nada de console na página (um log poderia levar um segredo).
      "no-console": "error",
    },
  },
  {
    files: ["e2e/**/*.ts", "scripts/**/*.mjs", "*.config.ts", "vite-plugins/**/*.ts"],
    rules: { "no-console": "off" },
  },
  {
    // Nos testes, "use" é o callback das fixtures do Playwright, não um hook do React.
    files: ["e2e/**/*.ts"],
    rules: { "react-hooks/rules-of-hooks": "off" },
  },
  {
    files: ["vite-plugins/sw-template.js"],
    languageOptions: {
      globals: { ...globals.serviceworker, __VERSION__: "readonly", __PRECACHE__: "readonly" },
    },
    extends: [js.configs.recommended],
    rules: { "no-console": "error" },
  },
  {
    files: ["scripts/**/*.mjs"],
    extends: [js.configs.recommended],
    languageOptions: { globals: { ...globals.node } },
  },
);
