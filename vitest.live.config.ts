import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    fileParallelism: false,
    include: ["apps/daemon/src/**/*.live.test.ts"],
    maxConcurrency: 1,
    // Real models occasionally skip an instructed tool call; one retry
    // separates that from a reproducible failure.
    retry: 1,
  },
});
