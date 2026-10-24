import { mkdir, symlink, writeFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { gitRepo, tempDir } from "../test/fixtures";
import { FileSearch } from "./file-search";

const fixture = async (root: string) => {
  await mkdir(path.join(root, "src"), { recursive: true });
  await Promise.all([
    writeFile(path.join(root, "src/settings-view.tsx"), "settings"),
    writeFile(path.join(root, "src/resetter.ts"), "settings"),
    writeFile(path.join(root, "s-e-t.txt"), "settings"),
  ]);
  return root;
};

describe("workspace file search", () => {
  it("ranks basename prefixes before substrings and subsequences", async () => {
    const root = await fixture(await tempDir("file-search"));
    const matches = await new FileSearch().search(root, "set");
    expect(matches.map((match) => match.path)).toStrictEqual([
      "src/settings-view.tsx",
      "src/resetter.ts",
      "s-e-t.txt",
    ]);
  });

  it("finds files and derived folders without Git and excludes .git and symlinks", async () => {
    const root = await fixture(await tempDir("file-search"));
    await mkdir(path.join(root, ".git"));
    await writeFile(path.join(root, ".git/hidden"), "private");
    await symlink(path.join(root, ".git"), path.join(root, "linked"));
    const matches = await new FileSearch().search(root, "");
    expect(matches).toContainEqual({ kind: "folder", path: "src/" });
    expect(
      matches.some(
        (match) => match.path.includes(".git") || match.path.includes("linked")
      )
    ).toBeFalsy();
  });

  it("uses Git ignores, deduplicates tracked files, and caches for thirty seconds", async () => {
    const root = await fixture(await gitRepo());
    await writeFile(path.join(root, ".gitignore"), "ignored.txt\n");
    await writeFile(path.join(root, "ignored.txt"), "ignored");
    let now = 0;
    const search = new FileSearch(() => now);
    const first = await search.search(root, "");
    await writeFile(path.join(root, "zzzz-new.txt"), "new");
    expect(first.filter((match) => match.path === "README.md")).toHaveLength(1);
    expect(first.some((match) => match.path === "ignored.txt")).toBeFalsy();
    await expect(search.search(root, "zzzz")).resolves.toStrictEqual([]);
    now = 30_001;
    await expect(search.search(root, "zzzz")).resolves.toStrictEqual([
      { kind: "file", path: "zzzz-new.txt" },
    ]);
  });

  it("caps results at fifty", async () => {
    const root = await tempDir("file-search-cap");
    await Promise.all(
      Array.from({ length: 60 }, (_, index) =>
        writeFile(path.join(root, `${index}.txt`), "text")
      )
    );
    await expect(new FileSearch().search(root, "")).resolves.toHaveLength(50);
  });
});
