import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { tempDir } from "../test/fixtures";
import { FileSearch } from "./file-search";

const failures = vi.hoisted(() => new Map<string, string>());
vi.mock(import("node:fs/promises"), async (importOriginal) => {
  const original = await importOriginal();
  const readdir = new Proxy(original.readdir, {
    apply: (target, receiver, args) => {
      const code = failures.get(String(args[0]));
      return code
        ? Promise.reject(
            Object.assign(new Error("Directory unavailable"), { code })
          )
        : Reflect.apply(target, receiver, args);
    },
  });
  return {
    ...original,
    readdir,
  };
});

describe("partial workspace searches", () => {
  afterEach(() => failures.clear());

  it.each(["EACCES", "ENOENT"])(
    "keeps sibling matches after a directory returns %s",
    async (code) => {
      const root = await tempDir("file-search-errors");
      const blocked = path.join(root, "unavailable");
      await Promise.all([
        mkdir(blocked),
        mkdir(path.join(root, "readable")),
        writeFile(path.join(root, "root.txt"), "root"),
      ]);
      await writeFile(path.join(root, "readable", "nested.txt"), "nested");
      failures.set(blocked, code);
      const matches = await new FileSearch().search(root, "");
      expect(matches).toContainEqual({ kind: "file", path: "root.txt" });
      expect(matches).toContainEqual({
        kind: "file",
        path: "readable/nested.txt",
      });
    }
  );
});
