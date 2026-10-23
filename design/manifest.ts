import { readFileSync } from "node:fs";
import path from "node:path";

export const GROUP_PREFIX = {
  breakpoint: "--breakpoint-",
  color: "--color-",
  container: "--container-",
  duration: "--transition-duration-",
  ease: "--ease-",
  fontFamily: "--font-",
  fontSize: "--text-",
  fontWeight: "--font-weight-",
  letterSpacing: "--tracking-",
  lineHeight: "--leading-",
  opacity: "--opacity-",
  radius: "--radius-",
  scale: "--scale-",
  shadow: "--shadow-",
  spacing: "--spacing-",
  zIndex: "--z-index-",
} as const;

export type TokenGroup = keyof typeof GROUP_PREFIX;

export interface TokenEntry {
  value: string;
  description?: string;
  paper?: string;
  loaderVariable?: string;
  fallback?: string[];
}

export interface TypographyRole {
  fontFamily?: string;
  fontSize: string;
  lineHeight: string;
  fontWeight: string;
  letterSpacing: string;
}

export interface Manifest {
  spacingBase: TokenEntry;
  tokens: Record<TokenGroup, Record<string, TokenEntry>>;
  typography: Record<string, TypographyRole>;
  aliases: { color: Record<string, string> };
  externalVariables: { exact: string[]; prefixes: string[] };
}

export const ROOT = path.resolve(import.meta.dirname, "..");
export const MANIFEST_PATH = path.join(ROOT, "design", "tokens.json");
export const TOKENS_CSS_PATH = path.join(
  ROOT,
  "apps",
  "web",
  "src",
  "styles",
  "tokens.css"
);

const TOKEN_KEY = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const VARIABLE_NAME = /^--[a-zA-Z][\w-]*$/u;
const PIXEL_BASE = /^(?:\d+(?:\.\d+)?|\.\d+)px$/u;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const fail = (message: string): never => {
  throw new Error(`design/tokens.json: ${message}`);
};

const entriesOf = (record: Record<string, unknown>) =>
  Object.entries(record).filter(([key]) => !key.startsWith("$"));

const recordAt = (value: unknown, where: string): Record<string, unknown> => {
  if (!isRecord(value)) {
    return fail(`${where} must be an object`);
  }
  return value;
};

const own = (record: Record<string, unknown>, key: string): unknown =>
  Object.hasOwn(record, key) ? record[key] : undefined;

const stringAt = (value: unknown, where: string): string => {
  if (typeof value !== "string" || !value.trim()) {
    return fail(`${where} must be a non-empty string`);
  }
  return value;
};

const stringsAt = (value: unknown, where: string): string[] => {
  if (!Array.isArray(value)) {
    return fail(`${where} must be an array of strings`);
  }
  return Array.from(value, (entry: unknown, index) =>
    stringAt(entry, `${where}[${index}]`)
  );
};

const validateEntry = (value: unknown, where: string) => {
  const entry = recordAt(value, where);
  stringAt(own(entry, "value"), `${where}.value`);
  for (const key of ["description", "paper", "loaderVariable"]) {
    if (Object.hasOwn(entry, key)) {
      const text = stringAt(entry[key], `${where}.${key}`);
      if (key === "loaderVariable" && !VARIABLE_NAME.test(text)) {
        fail(`${where}.${key} must be a CSS variable name`);
      }
    }
  }
  if (Object.hasOwn(entry, "fallback")) {
    stringsAt(entry.fallback, `${where}.fallback`);
  }
};

const validateName = (key: string, where: string) => {
  if (!TOKEN_KEY.test(key)) {
    fail(`${where} is not a kebab-case token name`);
  }
};

const validateGroup = (group: string, value: unknown) => {
  if (!isRecord(value)) {
    return fail(`tokens.${group} must be an object`);
  }
  for (const [key, entry] of entriesOf(value)) {
    validateName(key, `tokens.${group}.${key}`);
    validateEntry(entry, `tokens.${group}.${key}`);
  }
};

const requireRef = (
  tokens: Record<string, unknown>,
  group: TokenGroup,
  key: unknown,
  where: string
) => {
  const entries = recordAt(own(tokens, group), `tokens.${group}`);
  if (
    typeof key !== "string" ||
    !TOKEN_KEY.test(key) ||
    !Object.hasOwn(entries, key)
  ) {
    fail(`${where} references unknown ${group} token "${key}"`);
  }
};

export const parseManifest = (raw: unknown): Manifest => {
  if (!isRecord(raw) || !isRecord(raw.tokens)) {
    return fail("missing tokens object");
  }
  const tokens = recordAt(own(raw, "tokens"), "tokens");
  validateEntry(own(raw, "spacingBase"), "spacingBase");
  const spacingBase = recordAt(raw.spacingBase, "spacingBase");
  const base = stringAt(own(spacingBase, "value"), "spacingBase.value");
  const basePixels = Number(base.slice(0, -2));
  if (
    !PIXEL_BASE.test(base) ||
    !Number.isFinite(basePixels) ||
    basePixels <= 0
  ) {
    fail("spacingBase.value must be a positive pixel length");
  }
  for (const group of Object.keys(GROUP_PREFIX)) {
    validateGroup(group, own(tokens, group));
  }
  for (const group of Object.keys(raw.tokens)) {
    if (!Object.hasOwn(GROUP_PREFIX, group)) {
      fail(`unknown token group "${group}"`);
    }
  }
  const external = recordAt(own(raw, "externalVariables"), "externalVariables");
  for (const key of ["exact", "prefixes"]) {
    for (const name of stringsAt(
      own(external, key),
      `externalVariables.${key}`
    )) {
      if (!VARIABLE_NAME.test(name)) {
        fail(`externalVariables.${key} must contain CSS variable names`);
      }
    }
  }
  const aliases = recordAt(own(raw, "aliases"), "aliases");
  const colors = recordAt(own(aliases, "color"), "aliases.color");
  const colorTokens = recordAt(own(tokens, "color"), "tokens.color");
  for (const [alias, target] of entriesOf(colors)) {
    validateName(alias, `aliases.color.${alias}`);
    if (Object.hasOwn(colorTokens, alias)) {
      fail(`alias color.${alias} shadows a Paper color token`);
    }
    requireRef(tokens, "color", target, `aliases.color.${alias}`);
  }
  const typography = recordAt(own(raw, "typography"), "typography");
  for (const [name, value] of Object.entries(typography)) {
    const where = `typography.${name}`;
    validateName(name, where);
    const role = recordAt(value, where);
    for (const group of [
      "fontSize",
      "lineHeight",
      "fontWeight",
      "letterSpacing",
    ] as const) {
      requireRef(tokens, group, own(role, group), where);
    }
    if (Object.hasOwn(role, "fontFamily")) {
      requireRef(tokens, "fontFamily", role.fontFamily, where);
    }
  }
  // All required structures, entries, metadata and references are validated above.
  return raw as unknown as Manifest;
};

export const loadManifest = (file = MANIFEST_PATH): Manifest =>
  parseManifest(JSON.parse(readFileSync(file, "utf-8")));

export const tokenEntries = (manifest: Manifest, group: TokenGroup) =>
  entriesOf(manifest.tokens[group]) as [string, TokenEntry][];

export const aliasEntries = (manifest: Manifest) =>
  entriesOf(manifest.aliases.color) as [string, string][];

/** Every CSS custom property the manifest defines, including aliases. */
export const definedVariables = (manifest: Manifest): Set<string> => {
  const names = new Set<string>(["--spacing"]);
  for (const group of Object.keys(GROUP_PREFIX) as TokenGroup[]) {
    for (const [key] of tokenEntries(manifest, group)) {
      names.add(`${GROUP_PREFIX[group]}${key}`);
    }
  }
  for (const [alias] of aliasEntries(manifest)) {
    names.add(`--color-${alias}`);
  }
  return names;
};

export const isAuthorizedVariable = (
  manifest: Manifest,
  defined: Set<string>,
  name: string
) =>
  defined.has(name) ||
  manifest.externalVariables.exact.includes(name) ||
  manifest.externalVariables.prefixes.some((prefix) => name.startsWith(prefix));
