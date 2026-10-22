import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  definedVariables,
  loadManifest,
  parseManifest,
  TOKENS_CSS_PATH,
} from "../../design/manifest.ts";
import { renderTokensCss } from "../../design/scripts/build-tokens.ts";

const manifest = loadManifest();

describe("token manifest", () => {
  it("generated tokens.css matches the manifest", () => {
    expect(readFileSync(TOKENS_CSS_PATH, "utf-8")).toBe(
      renderTokensCss(manifest)
    );
  });

  it("keeps the Paper spacing scale and brand accent", () => {
    expect(
      Object.values(manifest.tokens.spacing).map((t) => t.value)
    ).toStrictEqual([
      "2px",
      "4px",
      "6px",
      "8px",
      "12px",
      "16px",
      "24px",
      "32px",
      "48px",
    ]);
    expect(manifest.tokens.color.accent?.value).toBe("#FF5A00");
  });

  it("defines shadcn aliases and Tailwind namespaces", () => {
    const names = definedVariables(manifest);
    expect(names.has("--color-background")).toBeTruthy();
    expect(names.has("--transition-duration-fast")).toBeTruthy();
    expect(names.has("--z-index-dialog")).toBeTruthy();
    expect(names.has("--color-accent-foreground")).toBeFalsy();
  });

  it("resets Tailwind default scales", () => {
    const css = renderTokensCss(manifest);
    for (const ns of ["--color-*", "--text-*", "--radius-*", "--shadow-*"]) {
      expect(css).toContain(`${ns}: initial;`);
    }
  });

  it.each([
    ["an alias to an unknown color", { aliases: { color: { brand: "nope" } } }],
    [
      "an alias shadowing a Paper color",
      { aliases: { color: { accent: "bg" } } },
    ],
    [
      "a typography role with an unknown size",
      {
        typography: {
          x: {
            fontSize: "9xl",
            fontWeight: "book",
            letterSpacing: "tight",
            lineHeight: "chat",
          },
        },
      },
    ],
  ])("rejects %s", (_label, patch) => {
    const raw = structuredClone(manifest);
    expect(() => parseManifest({ ...raw, ...patch })).toThrow(
      /design\/tokens\.json/u
    );
  });

  it("rejects unknown groups and malformed names", () => {
    const raw = structuredClone(manifest);
    expect(() =>
      parseManifest({ ...raw, tokens: { ...raw.tokens, gradient: {} } })
    ).toThrow(/unknown token group/u);
    expect(() =>
      parseManifest({
        ...raw,
        tokens: { ...raw.tokens, color: { Brand_Pink: { value: "#f0f" } } },
      })
    ).toThrow(/kebab-case/u);
  });
});
