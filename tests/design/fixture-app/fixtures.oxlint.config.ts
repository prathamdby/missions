import { defineConfig } from "oxlint";
import core from "ultracite/oxlint/core";

import web from "../../../apps/web/oxlint.config.ts";

// Lints fixtures with the real web config. The file name keeps oxlint from
// discovering it, so `ultracite check` applies the root ignore to this directory
// and only tests/design/lint-fixtures.test.ts (via -c) lints the negative cases.
export default defineConfig({
  env: web.env,
  extends: [web],
  ignorePatterns: core.ignorePatterns,
  rules: web.rules,
  settings: web.settings,
});
