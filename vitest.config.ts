import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    // The web app's `@/` path alias, so component tests can render real trees.
    alias: [
      {
        find: /^@\//u,
        replacement: fileURLToPath(new URL("apps/web/src/", import.meta.url)),
      },
    ],
  },
  test: {
    environment: "node",
    exclude: ["**/node_modules/**", "**/*.live.test.ts"],
    include: [
      "packages/*/src/**/*.test.ts",
      "apps/daemon/src/**/*.test.ts",
      "apps/web/src/**/*.test.ts",
      "apps/web/src/**/*.test.tsx",
      "tests/**/*.test.ts",
    ],
  },
});
