import { spawnSync } from "node:child_process";
import { globSync, readFileSync } from "node:fs";
import path from "node:path";

import { beforeAll, describe, expect, it } from "vitest";

import { ROOT } from "../../design/manifest.ts";

const FIXTURE_APP = path.join(import.meta.dirname, "fixture-app");
const OXLINT = path.join(ROOT, "node_modules", ".bin", "oxlint");
const EXPECT_HEADER = /^\/\/ expect: (?<rule>\S+)$/mu;
const RULE_CODE = /^(?<plugin>[\w-]+)\((?<rule>[\w-]+)\)$/u;

/** Every enforced design rule must have a fixture that trips it. */
const REQUIRED_RULES = [
  "missions-design/no-feature-tabindex",
  "missions-design/no-raw-scroll",
  "shadcn/no-arbitrary-values",
  "shadcn/no-inline-styles",
  "shadcn/no-raw-colors",
  "shadcn/no-restyle",
  "shadcn/no-unknown-classes",
  "shadcn/require-static-classes",
  "missions-design/no-off-scale-spacing",
  "missions-design/no-unauthorized-variables",
];

interface Diagnostic {
  code: string;
  filename: string;
  message: string;
  severity: string;
}

const toRule = (code: string) => {
  const groups = RULE_CODE.exec(code)?.groups;
  return groups ? `${groups.plugin}/${groups.rule}` : code;
};

const files = (pattern: string) =>
  globSync(pattern, { cwd: FIXTURE_APP }).toSorted();

const invalidCases = [
  ...files("src/cases/invalid/*.{ts,tsx}"),
  ...files("src/components/ui/invalid/*.tsx"),
];
const validCases = [
  ...files("src/cases/valid/*.{ts,tsx}"),
  ...files("src/components/ui/*.tsx"),
];

const expectedRule = (file: string) => {
  const rule = EXPECT_HEADER.exec(
    readFileSync(path.join(FIXTURE_APP, file), "utf-8")
  )?.groups?.rule;
  if (!rule) {
    throw new Error(`${file} is missing an "// expect: <rule>" header`);
  }
  return rule;
};

const byFile = new Map<string, Diagnostic[]>();

const lintFixtures = () => {
  const result = spawnSync(
    OXLINT,
    [
      "-c",
      "fixtures.oxlint.config.ts",
      "--format",
      "json",
      ...invalidCases,
      ...validCases,
    ],
    { cwd: FIXTURE_APP, encoding: "utf-8", timeout: 120_000 }
  );
  if (result.error) {
    throw result.error;
  }
  const report = JSON.parse(result.stdout) as { diagnostics: Diagnostic[] };
  for (const diagnostic of report.diagnostics) {
    const list = byFile.get(diagnostic.filename) ?? [];
    list.push(diagnostic);
    byFile.set(diagnostic.filename, list);
  }
};

describe("design lint fixtures", () => {
  beforeAll(lintFixtures, 120_000);

  it("cover every enforced rule", () => {
    const covered = new Set(invalidCases.map(expectedRule));
    expect([...covered].toSorted()).toStrictEqual(REQUIRED_RULES.toSorted());
  });

  it.each(invalidCases)("%s fails only for its intended rule", (file) => {
    const diagnostics = byFile.get(file) ?? [];
    expect(diagnostics.length).toBeGreaterThan(0);
    expect(new Set(diagnostics.map((d) => toRule(d.code)))).toStrictEqual(
      new Set([expectedRule(file)])
    );
    for (const diagnostic of diagnostics) {
      expect(diagnostic.severity).toBe("error");
    }
  });

  it.each(validCases)("%s passes every rule", (file) => {
    expect(byFile.get(file) ?? []).toStrictEqual([]);
  });

  it("rejects each migrated raw padding value, including safe-area floors", () => {
    const messages = (
      byFile.get("src/components/ui/invalid/raw-padding.tsx") ?? []
    ).map((diagnostic) => diagnostic.message);
    for (const cls of [
      "px-[40px]",
      "px-[5px]",
      "py-[3px]",
      "pb-[max(env(safe-area-inset-bottom),12px)]",
      "pt-[max(env(safe-area-inset-top),4px)]",
      "pb-[max(env(safe-area-inset-bottom),21px)]",
    ]) {
      expect(
        messages.some((message) => message.includes(`"${cls}"`))
      ).toBeTruthy();
    }
  });

  it("rejects wrong-edge, non-padding, non-spacing and arbitrary safe-area expressions", () => {
    expect(
      byFile.get("src/components/ui/invalid/safe-area-expression.tsx")
    ).toHaveLength(4);
  });

  it("reads the real web theme rather than the bundled grammar", () => {
    const [unknown] =
      byFile.get("src/cases/invalid/no-unknown-classes.tsx") ?? [];
    expect(unknown?.message).toContain("apps/web/src/app/globals.css");
  });
});
