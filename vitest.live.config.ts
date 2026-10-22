import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    fileParallelism: false,
    include: ["apps/daemon/src/**/*.live.test.ts"],
    maxConcurrency: 1,
  },
});
