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

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const fail = (message: string): never => {
  throw new Error(`design/tokens.json: ${message}`);
};

const entriesOf = (record: Record<string, unknown>) =>
  Object.entries(record).filter(([key]) => !key.startsWith("$"));

const validateGroup = (group: string, value: unknown) => {
  if (!isRecord(value)) {
    return fail(`tokens.${group} must be an object`);
  }
  for (const [key, entry] of entriesOf(value)) {
    if (!TOKEN_KEY.test(key)) {
      fail(`tokens.${group}.${key} is not a kebab-case token name`);
    }
    if (!(isRecord(entry) && typeof entry.value === "string" && entry.value)) {
      fail(`tokens.${group}.${key}.value must be a non-empty string`);
    }
  }
};

const requireRef = (
  manifest: Manifest,
  group: TokenGroup,
  key: string | undefined,
  where: string
) => {
  if (key === undefined || !(key in manifest.tokens[group])) {
    fail(`${where} references unknown ${group} token "${key}"`);
  }
};

export const parseManifest = (raw: unknown): Manifest => {
  if (!isRecord(raw) || !isRecord(raw.tokens)) {
    return fail("missing tokens object");
  }
  for (const group of Object.keys(GROUP_PREFIX)) {
    validateGroup(group, raw.tokens[group]);
  }
  for (const group of Object.keys(raw.tokens)) {
    if (!(group in GROUP_PREFIX)) {
      fail(`unknown token group "${group}"`);
    }
  }
  const manifest = raw as unknown as Manifest;
  for (const [alias, target] of entriesOf(manifest.aliases.color)) {
    if (alias in manifest.tokens.color) {
      fail(`alias color.${alias} shadows a Paper color token`);
    }
    requireRef(manifest, "color", target as string, `aliases.color.${alias}`);
  }
  for (const [name, role] of Object.entries(manifest.typography)) {
    const where = `typography.${name}`;
    requireRef(manifest, "fontSize", role.fontSize, where);
    requireRef(manifest, "lineHeight", role.lineHeight, where);
    requireRef(manifest, "fontWeight", role.fontWeight, where);
    requireRef(manifest, "letterSpacing", role.letterSpacing, where);
    if (role.fontFamily !== undefined) {
      requireRef(manifest, "fontFamily", role.fontFamily, where);
    }
  }
  return manifest;
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
