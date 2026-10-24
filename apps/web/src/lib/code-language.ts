/** Shiki language ids by lowercase file extension. */
const BY_EXTENSION = new Map<string, string>([
  ["astro", "astro"],
  ["bash", "shellscript"],
  ["c", "c"],
  ["cc", "cpp"],
  ["cjs", "javascript"],
  ["clj", "clojure"],
  ["cpp", "cpp"],
  ["cs", "csharp"],
  ["css", "css"],
  ["cts", "typescript"],
  ["cxx", "cpp"],
  ["dart", "dart"],
  ["diff", "diff"],
  ["dockerfile", "docker"],
  ["erl", "erlang"],
  ["ex", "elixir"],
  ["exs", "elixir"],
  ["fish", "fish"],
  ["go", "go"],
  ["gql", "graphql"],
  ["graphql", "graphql"],
  ["groovy", "groovy"],
  ["h", "c"],
  ["hcl", "hcl"],
  ["hh", "cpp"],
  ["hpp", "cpp"],
  ["hs", "haskell"],
  ["htm", "html"],
  ["html", "html"],
  ["ini", "ini"],
  ["java", "java"],
  ["js", "javascript"],
  ["json", "json"],
  ["json5", "json5"],
  ["jsonc", "jsonc"],
  ["jsx", "jsx"],
  ["kt", "kotlin"],
  ["kts", "kotlin"],
  ["less", "less"],
  ["lua", "lua"],
  ["markdown", "markdown"],
  ["md", "markdown"],
  ["mdx", "mdx"],
  ["mjs", "javascript"],
  ["mk", "make"],
  ["ml", "ocaml"],
  ["mts", "typescript"],
  ["nix", "nix"],
  ["patch", "diff"],
  ["php", "php"],
  ["pl", "perl"],
  ["prisma", "prisma"],
  ["proto", "proto"],
  ["ps1", "powershell"],
  ["py", "python"],
  ["r", "r"],
  ["rb", "ruby"],
  ["rs", "rust"],
  ["sass", "sass"],
  ["scala", "scala"],
  ["scss", "scss"],
  ["sh", "shellscript"],
  ["sql", "sql"],
  ["svelte", "svelte"],
  ["svg", "xml"],
  ["swift", "swift"],
  ["tf", "terraform"],
  ["toml", "toml"],
  ["ts", "typescript"],
  ["tsx", "tsx"],
  ["vue", "vue"],
  ["xml", "xml"],
  ["yaml", "yaml"],
  ["yml", "yaml"],
  ["zig", "zig"],
  ["zsh", "shellscript"],
]);

/** Shiki language ids for whole lowercase file names without a telling extension. */
const BY_NAME = new Map<string, string>([
  [".bash_profile", "shellscript"],
  [".bashrc", "shellscript"],
  [".env", "dotenv"],
  [".zshrc", "shellscript"],
  ["cmakelists.txt", "cmake"],
  ["dockerfile", "docker"],
  ["gemfile", "ruby"],
  ["gnumakefile", "make"],
  ["makefile", "make"],
  ["rakefile", "ruby"],
]);

const NAME_PREFIXES: readonly (readonly [string, string])[] = [
  [".env.", "dotenv"],
  ["dockerfile.", "docker"],
];

/**
 * The Shiki language for a repository path, or null when the file should stay
 * plain text.
 */
export const languageForPath = (path: string): string | null => {
  const name = path.slice(path.lastIndexOf("/") + 1).toLowerCase();
  const named = BY_NAME.get(name);
  if (named) {
    return named;
  }
  for (const [prefix, language] of NAME_PREFIXES) {
    if (name.startsWith(prefix)) {
      return language;
    }
  }
  const dot = name.lastIndexOf(".");
  // No extension, or a dotfile such as ".gitignore" that names no language.
  if (dot <= 0) {
    return null;
  }
  return BY_EXTENSION.get(name.slice(dot + 1)) ?? null;
};

/** Every language the resolver can return, for checking against the highlighter. */
export const knownLanguages = (): string[] => [
  ...new Set([
    ...BY_EXTENSION.values(),
    ...BY_NAME.values(),
    ...NAME_PREFIXES.map(([, language]) => language),
  ]),
];
