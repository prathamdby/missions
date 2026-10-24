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

// The Paper Foundations spacing scale; other steps are named off-grid values.
const PAPER_SPACING = [
  "2xs",
  "xs",
  "sm",
  "md",
  "lg",
  "xl",
  "2xl",
  "3xl",
  "4xl",
];

describe("token manifest", () => {
  it("generates scoped Pele color aliases and rejects non-color references", () => {
    expect(renderTokensCss(manifest)).toContain(
      ".pele {\n  --pele-bg: var(--color-surface-raised);"
    );
    expect(definedVariables(manifest).has("--pele-fg")).toBeTruthy();
    expect(() =>
      parseManifest({
        ...manifest,
        aliases: { ...manifest.aliases, pele: { font: "sans" } },
      })
    ).toThrow(/unknown color token/u);
  });

  it("generated tokens.css matches the manifest", () => {
    expect(readFileSync(TOKENS_CSS_PATH, "utf-8")).toBe(
      renderTokensCss(manifest)
    );
  });

  it("preserves the exact Paper J4J opened Select shadow without stacking rings", () => {
    const active = manifest.tokens.shadow["button-active"];
    expect(active).toStrictEqual({
      description:
        "Paper J4J opened Select: replaces the button ring with border-strong while preserving its top highlight and drop shadow.",
      value:
        "inset 0 1px 0 #FFFFFF1F, 0 0 0 1px var(--color-border-strong), 0 1px 2px var(--color-shadow)",
    });
    expect(active?.value).toBe(
      manifest.tokens.shadow.button?.value.replace(
        "var(--color-border)",
        "var(--color-border-strong)"
      )
    );
    expect(
      definedVariables(manifest).has("--shadow-button-active")
    ).toBeTruthy();
    expect(renderTokensCss(manifest)).toContain(
      `--shadow-button-active: ${active?.value};`
    );
  });

  it("keeps the Paper spacing scale and brand accent", () => {
    const { spacing } = manifest.tokens;
    const scale = Object.fromEntries(
      PAPER_SPACING.map((name) => [name, spacing[name]?.value])
    );
    expect(scale).toStrictEqual({
      "2xl": "24px",
      "2xs": "2px",
      "3xl": "32px",
      "4xl": "48px",
      lg: "12px",
      md: "8px",
      sm: "6px",
      xl: "16px",
      xs: "4px",
    });
    expect(manifest.tokens.color.accent?.value).toBe("#FF5A00");
  });

  it("documents where Paper uses every off-grid spacing step", () => {
    const undocumented = Object.entries(manifest.tokens.spacing)
      .filter(([name]) => !PAPER_SPACING.includes(name))
      .filter(([, token]) => !token.description?.includes("Paper"))
      .map(([name]) => name);
    expect(undocumented).toStrictEqual([]);
  });

  it("preserves the exact authored primitive padding values", () => {
    const { spacing } = manifest.tokens;
    expect(
      Object.fromEntries(
        ["tight", "stack", "lg", "xs", "dialog-hero", "drawer-bottom"].map(
          (name) => [name, spacing[name]?.value]
        )
      )
    ).toStrictEqual({
      "dialog-hero": "40px",
      "drawer-bottom": "21px",
      lg: "12px",
      stack: "3px",
      tight: "5px",
      xs: "4px",
    });
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

  it.each([
    { spacingBase: null },
    { spacingBase: { value: "0px" } },
    { spacingBase: { value: "4rem" } },
    { spacingBase: { description: 1, value: "4px" } },
    { aliases: null },
    { aliases: { color: [] } },
    { aliases: { color: { brand: 4 } } },
    { typography: [] },
    { typography: { body: null } },
    { typography: { body: {} } },
    { externalVariables: null },
    { externalVariables: { exact: "--font", prefixes: [] } },
    { externalVariables: { exact: [], prefixes: [""] } },
    { externalVariables: { exact: ["color"], prefixes: [] } },
    { externalVariables: { exact: [null], prefixes: [] } },
  ])("rejects malformed manifest structure: %j", (patch) => {
    expect(() =>
      parseManifest({ ...structuredClone(manifest), ...patch })
    ).toThrow(/design\/tokens\.json/u);
  });

  it.each([
    { value: "" },
    { value: " " },
    { description: [], value: "red" },
    { paper: 1, value: "red" },
    { loaderVariable: "not-a-variable", value: "red" },
    { fallback: "sans-serif", value: "red" },
    { fallback: [false], value: "red" },
  ])("rejects malformed token metadata: %j", (entry) => {
    const raw = structuredClone(manifest);
    expect(() =>
      parseManifest({
        ...raw,
        tokens: { ...raw.tokens, color: { bg: entry } },
      })
    ).toThrow(/design\/tokens\.json/u);
  });

  it.each(["toString", "constructor", "__proto__"])(
    "rejects inherited reference name %s",
    (target) => {
      expect(() =>
        parseManifest({
          ...structuredClone(manifest),
          aliases: { color: { brand: target } },
        })
      ).toThrow(/unknown color token/u);
      expect(() =>
        parseManifest({
          ...structuredClone(manifest),
          typography: {
            body: { ...manifest.typography.body, fontSize: target },
          },
        })
      ).toThrow(/unknown fontSize token/u);
    }
  );

  it("rejects inherited token groups, entries and required values", () => {
    const raw = structuredClone(manifest);
    expect(() =>
      parseManifest({
        ...raw,
        tokens: { ...raw.tokens, constructor: {} },
      })
    ).toThrow(/unknown token group/u);
    expect(() =>
      parseManifest({
        ...raw,
        tokens: Object.create(raw.tokens),
      })
    ).toThrow(/must be an object/u);
    expect(() =>
      parseManifest({
        ...raw,
        tokens: {
          ...raw.tokens,
          color: Object.create({ bg: { value: "red" } }),
        },
      })
    ).toThrow(/unknown color token/u);
    expect(() =>
      parseManifest({
        ...raw,
        spacingBase: Object.create({ value: "4px" }),
      })
    ).toThrow(/spacingBase.value/u);
  });
});
