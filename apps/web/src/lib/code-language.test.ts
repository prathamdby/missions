import { describe, expect, it } from "vitest";

import { supportsLanguage } from "@/components/ui/syntax-highlight";

import { knownLanguages, languageForPath } from "./code-language";

describe("file language resolution", () => {
  it.each([
    ["src/app.ts", "typescript"],
    ["src/view.tsx", "tsx"],
    ["index.js", "javascript"],
    ["Button.jsx", "jsx"],
    ["build.mjs", "javascript"],
    ["config.cjs", "javascript"],
    ["package.json", "json"],
    ["docs/README.md", "markdown"],
    ["styles/app.css", "css"],
    ["styles/app.scss", "scss"],
    ["public/index.html", "html"],
    ["tool.py", "python"],
    ["Rakefile", "ruby"],
    ["lib/thing.rb", "ruby"],
    ["cmd/main.go", "go"],
    ["src/lib.rs", "rust"],
    ["Main.java", "java"],
    ["App.kt", "kotlin"],
    ["View.swift", "swift"],
    ["main.c", "c"],
    ["main.h", "c"],
    ["main.cpp", "cpp"],
    ["Program.cs", "csharp"],
    ["index.php", "php"],
    ["scripts/run.sh", "shellscript"],
    ["scripts/run.bash", "shellscript"],
    ["scripts/run.zsh", "shellscript"],
    [".github/workflows/ci.yml", "yaml"],
    ["compose.yaml", "yaml"],
    ["Cargo.toml", "toml"],
    ["migrations/001.sql", "sql"],
    ["pom.xml", "xml"],
    ["App.vue", "vue"],
    ["Page.svelte", "svelte"],
    ["SRC/UPPER.TS", "typescript"],
  ])("maps %s to %s", (path, language) => {
    expect(languageForPath(path)).toBe(language);
  });

  it.each([
    ["Dockerfile", "docker"],
    ["deploy/Dockerfile", "docker"],
    ["Dockerfile.dev", "docker"],
    ["api.dockerfile", "docker"],
    ["Makefile", "make"],
    ["sub/GNUmakefile", "make"],
    [".env.local", "dotenv"],
  ])("recognizes the special file name %s", (path, language) => {
    expect(languageForPath(path)).toBe(language);
  });

  it.each([
    "LICENSE",
    "notes.txt",
    "image.png",
    ".gitignore",
    "archive.tar.unknownext",
    "weird.constructor",
    "dir.d/",
  ])("keeps %s plain", (path) => {
    expect(languageForPath(path)).toBeNull();
  });

  it("only returns languages the highlighter accepts", () => {
    expect(
      knownLanguages().filter((language) => !supportsLanguage(language))
    ).toStrictEqual([]);
  });
});
