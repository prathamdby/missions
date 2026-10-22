import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    exclude: ["**/node_modules/**", "**/*.live.test.ts"],
    include: [
      "packages/*/src/**/*.test.ts",
      "apps/daemon/src/**/*.test.ts",
      "tests/**/*.test.ts",
    ],
  },
});
