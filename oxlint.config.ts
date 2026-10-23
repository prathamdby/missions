import path from "node:path";

import { defineConfig } from "oxlint";
import core from "ultracite/oxlint/core";
import shadcn from "ultracite/oxlint/shadcn";
import vitest from "ultracite/oxlint/vitest";

/**
 * Dot Matrix loaders, installed verbatim from the @dotmatrix shadcn registry
 * (see design/README.md). Kept as shipped so `shadcn add` can update them;
 * `components/ui/spinner.tsx` is the only consumer.
 */
export const DOTMATRIX_VENDORED = [
  "**/components/dotmatrix-loader.css",
  "**/components/ui/dotm-square-*.tsx",
  "**/lib/dotmatrix-core.tsx",
  "**/lib/dotmatrix-hooks.ts",
];

// Absolute: oxlint rejects relative plugin specifiers in configs reached through `extends`.
export const designPlugin = {
  name: "missions-design",
  specifier: path.join(import.meta.dirname, "design/lint/plugin.ts"),
};

// Enabled by UI configs (apps/web): tooling under design/ legitimately builds variable names.
export const designRules = {
  "missions-design/no-off-scale-spacing": "error",
  "missions-design/no-unauthorized-variables": "error",
} as const;

export const designSettings = {
  shadcn: {
    note: "Design tokens live in design/tokens.json (see design/README.md). Do not disable rules to pass.",
  },
};

export default defineConfig({
  env: core.env,
  extends: [core, vitest, shadcn],
  // Negative design fixtures are linted on purpose by tests/design, never by `ultracite check`.
  ignorePatterns: [
    ...(core.ignorePatterns ?? []),
    "tests/design/fixture-app/**",
    ...DOTMATRIX_VENDORED,
  ],
  jsPlugins: [...shadcn.jsPlugins, designPlugin],
  settings: designSettings,
});
