import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import {
  aliasEntries,
  GROUP_PREFIX,
  loadManifest,
  ROOT,
  tokenEntries,
  TOKENS_CSS_PATH,
} from "../manifest.ts";
import type { Manifest, TokenGroup } from "../manifest.ts";

/** Tailwind defaults with no Paper equivalent. Resetting them keeps the vocabulary to the manifest. */
const RESET_NAMESPACES = [
  "--color-*",
  "--font-*",
  "--text-*",
  "--font-weight-*",
  "--tracking-*",
  "--leading-*",
  "--breakpoint-*",
  "--container-*",
  "--radius-*",
  "--shadow-*",
  "--inset-shadow-*",
  "--drop-shadow-*",
  "--text-shadow-*",
  "--blur-*",
  "--perspective-*",
  "--aspect-*",
  "--ease-*",
  "--animate-*",
];

const GROUP_ORDER: TokenGroup[] = [
  "color",
  "fontFamily",
  "fontSize",
  "fontWeight",
  "letterSpacing",
  "lineHeight",
  "spacing",
  "radius",
  "shadow",
  "opacity",
  "breakpoint",
  "container",
  "duration",
  "ease",
  "scale",
  "zIndex",
];

const UNQUOTED_FAMILY = /^[a-z-]+$/iu;

const quoteFamily = (family: string) =>
  UNQUOTED_FAMILY.test(family) ? family : `"${family}"`;

const valueOf = (
  group: TokenGroup,
  entry: Manifest["tokens"][TokenGroup][string]
) => {
  if (group !== "fontFamily") {
    return entry.value;
  }
  const stack = [
    ...(entry.loaderVariable ? [`var(${entry.loaderVariable})`] : []),
    quoteFamily(entry.value),
    ...(entry.fallback ?? []).map(quoteFamily),
  ];
  return stack.join(", ");
};

const comment = (text: string | undefined) =>
  text ? ` /* ${text.replaceAll("*/", "* /")} */` : "";

export const renderTokensCss = (manifest: Manifest): string => {
  const lines: string[] = [
    "/* Generated from design/tokens.json by `pnpm design:tokens`. Do not edit. */",
    "",
    "@theme static {",
    ...RESET_NAMESPACES.map((ns) => `  ${ns}: initial;`),
    "",
    `  --spacing: ${manifest.spacingBase.value};${comment(manifest.spacingBase.description)}`,
  ];
  for (const group of GROUP_ORDER) {
    lines.push("");
    for (const [key, entry] of tokenEntries(manifest, group)) {
      lines.push(
        `  ${GROUP_PREFIX[group]}${key}: ${valueOf(group, entry)};${comment(entry.description)}`
      );
    }
  }
  lines.push("");
  for (const [alias, target] of aliasEntries(manifest)) {
    lines.push(`  --color-${alias}: var(--color-${target});`);
  }
  lines.push(
    "",
    "  --default-font-family: var(--font-sans);",
    "  --default-mono-font-family: var(--font-mono);",
    "  --default-transition-duration: var(--transition-duration-fast);",
    "  --default-transition-timing-function: var(--ease-out);",
    "}"
  );
  if (manifest.aliases.pele) {
    lines.push("", ".pele {");
    for (const [alias, target] of Object.entries(manifest.aliases.pele)) {
      lines.push(`  --pele-${alias}: var(--color-${target});`);
    }
    lines.push("}");
  }
  for (const [name, role] of Object.entries(manifest.typography)) {
    lines.push(
      "",
      `@utility type-${name} {`,
      ...(role.fontFamily
        ? [`  font-family: var(--font-${role.fontFamily});`]
        : []),
      `  font-size: var(--text-${role.fontSize});`,
      `  line-height: var(--leading-${role.lineHeight});`,
      `  font-weight: var(--font-weight-${role.fontWeight});`,
      `  letter-spacing: var(--tracking-${role.letterSpacing});`,
      "}"
    );
  }
  return `${lines.join("\n")}\n`;
};

const main = () => {
  const check = process.argv.includes("--check");
  const expected = renderTokensCss(loadManifest());
  const relative = path.relative(ROOT, TOKENS_CSS_PATH);
  if (!check) {
    writeFileSync(TOKENS_CSS_PATH, expected);
    process.stdout.write(`Wrote ${relative}\n`);
    return;
  }
  let actual = "";
  try {
    actual = readFileSync(TOKENS_CSS_PATH, "utf-8");
  } catch {
    // Missing file is reported as out of date below.
  }
  if (actual !== expected) {
    process.stderr.write(
      `${relative} is out of date with design/tokens.json. Run \`pnpm design:tokens\`.\n`
    );
    process.exitCode = 1;
    return;
  }
  process.stdout.write(`${relative} matches design/tokens.json\n`);
};

if (import.meta.main) {
  main();
}
