import js from "@eslint/js";
import globals from "globals";

export default [
  {
    ignores: [
      "apps/**",
      "launcher/styles.css",
      "_site/**",
      "node_modules/**",
    ],
  },
  js.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: "module",
      globals: {
        ...globals.browser,
        ...globals.serviceworker,
      },
    },
    rules: {
      // Warn on unused vars so CI surfaces them, but don't fail the
      // build — mechanism.js intentionally keeps a few scratch locals
      // and removing them risks breaking the watch animation.
      "no-unused-vars": [
        "warn",
        {
          argsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
        },
      ],
      // Empty catches are used as silent best-effort guards.
      "no-empty": ["error", { allowEmptyCatch: true }],
    },
  },
];
