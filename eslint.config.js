import tsParser from "@typescript-eslint/parser";
import sonarjs from "eslint-plugin-sonarjs";

export default [
  {
    files: ["src/**/*.ts"],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: "latest",
        sourceType: "module",
      },
    },
    plugins: {
      sonarjs,
    },
    rules: {
      ...sonarjs.configs.recommended.rules,
    },
  },
  {
    files: ["src/dialog.ts"],
    rules: {
      "sonarjs/os-command": "off", // osascript 실행은 의도된 동작
    },
  },
  {
    ignores: ["dist/**", "node_modules/**"],
  },
];
