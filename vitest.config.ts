import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    testTimeout: 30000,
    include: ["src/**/*.{test,spec}.ts"],
    exclude: ["dist/**", "node_modules/**"],
  },
});
