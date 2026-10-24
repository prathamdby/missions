import { globSync, readFileSync } from "node:fs";
import path from "node:path";

import { parse } from "postcss";
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

  it("keeps focus rings on interactive elements and selection opt-in", () => {
    const css = parse(
      readFileSync(path.join(ROOT, "apps/web/src/app/globals.css"), "utf-8")
    );
    const rings: string[] = [];
    const selections: Record<string, string> = {};
    css.walkRules((rule) => {
      rule.walkDecls("box-shadow", (decl) => {
        if (decl.value === "var(--shadow-focus)") {
          rings.push(rule.selector.replaceAll(/\s+/gu, ""));
        }
      });
      rule.walkDecls("user-select", (decl) => {
        selections[rule.selector] = decl.value;
      });
    });
    expect(rings).toStrictEqual([
      ':is(a[href], button, input:not([type="hidden"]), textarea, select, summary, [contenteditable="true"], [role="button"], [role="link"], [role="tab"], [role="option"], [role="menuitem"], [role="menuitemcheckbox"], [role="menuitemradio"], [role="checkbox"], [role="radio"], [role="switch"], [role="combobox"], [role="slider"], [role="treeitem"]):focus-visible'.replaceAll(
        /\s+/gu,
        ""
      ),
    ]);
    expect(selections.body).toBe("none");
    expect(Object.values(selections)).toContain("text");
  });
});
