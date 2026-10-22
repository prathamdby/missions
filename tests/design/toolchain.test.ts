import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { ROOT } from "../../design/manifest.ts";

const readJson = (file: string) =>
  JSON.parse(readFileSync(path.join(ROOT, file), "utf-8")) as {
    version: string;
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };

// Aliases (`npm:zod@3.25.76`) are allowed when they pin an exact version.
const EXACT_VERSION = /^(?:npm:(?:@[\w.-]+\/)?[\w.-]+@)?\d+\.\d+\.\d+$/u;
const MANIFESTS = [
  "package.json",
  "apps/web/package.json",
  "apps/daemon/package.json",
  "packages/protocol/package.json",
];

describe("toolchain", () => {
  it("runs Ultracite major 8", () => {
    const { version } = readJson("node_modules/ultracite/package.json");
    expect(version.split(".")[0]).toBe("8");
  });

  it.each(MANIFESTS)("%s pins exact dependency versions", (file) => {
    const { dependencies = {}, devDependencies = {} } = readJson(file);
    const loose = Object.entries({
      ...dependencies,
      ...devDependencies,
    }).filter(
      ([, range]) =>
        !(range.startsWith("workspace:") || EXACT_VERSION.test(range))
    );
    expect(loose).toStrictEqual([]);
  });
});
