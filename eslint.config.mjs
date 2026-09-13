import tseslint from "typescript-eslint";
import obsidianmd from "eslint-plugin-obsidianmd";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export default [
  { ignores: ["**/*.generated.ts", "**/*.d.ts", "node_modules/**", ".mobile-dist/**", ".test-build/**"] },
  {
    files: ["src/**/*.ts", "mobile-src/**/*.ts"],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        project: "./tsconfig.lint.json",
        tsconfigRootDir: fileURLToPath(new URL(".", import.meta.url)),
      },
    },
    plugins: { "@typescript-eslint": tseslint.plugin, obsidianmd },
    rules: {
      "obsidianmd/no-unsupported-api": "error",
      "no-restricted-syntax": ["error", {
        selector: "CallExpression[callee.type='Identifier'][callee.name=/^(setTimeout|clearTimeout|setInterval|clearInterval)$/]",
        message: "Use window timers for UI work or explicit Node timers in desktop-only services.",
      }],
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-unsafe-call": "error",
      "@typescript-eslint/no-unsafe-member-access": "error",
      "@typescript-eslint/no-unsafe-assignment": "error",
      "@typescript-eslint/no-unsafe-return": "error",
      "@typescript-eslint/no-unsafe-argument": "error",
      "@typescript-eslint/no-redundant-type-constituents": "error",
      "@typescript-eslint/prefer-promise-reject-errors": "error",
    },
  },
  {
    files: ["mobile-src/**/*.ts"],
    rules: {
      "obsidianmd/no-unsupported-api": ["error", {
        minAppVersion: JSON.parse(readFileSync(new URL("./mobile-src/manifest.json", import.meta.url), "utf8")).minAppVersion,
      }],
    },
  },
];
