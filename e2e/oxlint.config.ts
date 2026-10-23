import { defineConfig } from "oxlint";
import core from "ultracite/oxlint/core";

import root from "../oxlint.config.ts";

// Playwright specs: the root config's Vitest rules would demand vitest imports
// and *.test.ts names, which do not apply to @playwright/test.
export default defineConfig({
  env: root.env,
  extends: [core],
  ignorePatterns: root.ignorePatterns,
  settings: root.settings,
});
