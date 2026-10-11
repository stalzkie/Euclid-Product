import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { FlatCompat } from "@eslint/eslintrc";

const compat = new FlatCompat({
  baseDirectory: dirname(fileURLToPath(import.meta.url)),
});

export default [
  {
    ignores: [
      ".next/**",
      "node_modules/**",
      "coverage/**",
      "design-reference/**",
      "next-env.d.ts",
      "public/widget.js", // Hand-written ES5 for maximum browser reach.
    ],
  },
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  {
    rules: {
      // Unused values are usually a mistake, but a leading underscore is the
      // conventional way to say "deliberately ignored".
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },
  {
    // A bare object or array literal is the documented shape of these config
    // files, so naming it first would only satisfy the linter.
    files: ["*.config.mjs", "*.config.ts"],
    rules: { "import/no-anonymous-default-export": "off" },
  },
  {
    // Scripts and tests are developer tools, not shipped code.
    files: ["scripts/**/*.mjs", "tests/**/*.ts"],
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      "no-console": "off",
    },
  },
];
