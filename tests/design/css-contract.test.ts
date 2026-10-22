import { globSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { checkCss } from "../../design/contract/css.ts";
import { loadManifest, ROOT } from "../../design/manifest.ts";

const FIXTURES = path.join(import.meta.dirname, "css");
const EXPECT_HEADER = /^\/\* expect: (?<rule>\S+) \*\//u;
const manifest = loadManifest();

const read = (file: string) => readFileSync(path.join(FIXTURES, file), "utf-8");
const invalid = globSync("invalid/*.css", { cwd: FIXTURES }).toSorted();
const valid = globSync("valid/*.css", { cwd: FIXTURES }).toSorted();

describe("CSS design contract", () => {
  it.each(invalid)("%s fails only for its intended rule", (file) => {
    const source = read(file);
    const expected = EXPECT_HEADER.exec(source)?.groups?.rule;
    expect(expected).toBeDefined();
    const violations = checkCss(source, manifest, file);
    expect(violations.length).toBeGreaterThan(0);
    expect(new Set(violations.map((v) => v.rule))).toStrictEqual(
      new Set([expected])
    );
  });

  it.each(valid)("%s passes", (file) => {
    expect(checkCss(read(file), manifest, file)).toStrictEqual([]);
  });

  it("passes on the real web stylesheet", () => {
    const globals = path.join(ROOT, "apps/web/src/app/globals.css");
    expect(
      checkCss(readFileSync(globals, "utf-8"), manifest, globals)
    ).toStrictEqual([]);
  });
});
