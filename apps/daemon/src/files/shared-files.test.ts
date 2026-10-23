import { readFile, symlink, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { tempDir } from "../test/fixtures";
import { SharedFiles } from "./shared-files";

describe("persistent shared mission files", () => {
  it("seeds shared knowledge, persists edits across restart, and isolates missions", async () => {
    const dir = await tempDir("shared");
    const files = new SharedFiles(dir);
    await files.write("m1", "plans/plan.md", "# Work\n\n- Build");
    await files.write("m1", "AGENTS.md", "Custom guidance");
    const restarted = new SharedFiles(dir);
    await expect(restarted.read("m1", "AGENTS.md")).resolves.toMatchObject({
      content: "Custom guidance",
      kind: "text",
    });
    await expect(restarted.read("m1", "plans/plan.md")).resolves.toMatchObject({
      content: "# Work\n\n- Build",
      kind: "text",
    });
    const tree = await restarted.list("m1", "");
    expect(tree.entries.map((entry) => entry.path).toSorted()).toStrictEqual([
      "AGENTS.md",
      "CREW.md",
      "errors",
      "handoffs",
      "plans",
      "results",
    ]);
    await expect(restarted.read("m2", "plans/plan.md")).resolves.toMatchObject({
      kind: "missing",
    });
  });

  it("rejects traversal and symlink escapes for reads and new writes", async () => {
    const files = new SharedFiles(await tempDir("shared"));
    const outside = await tempDir("outside");
    await files.ensure("m1");
    await writeFile(path.join(outside, "secret.txt"), "private");
    await symlink(outside, path.join(files.root("m1"), "escape"));
    await expect(files.read("m1", "../other")).rejects.toMatchObject({
      code: "forbidden",
    });
    await expect(files.read("m1", "escape/secret.txt")).rejects.toMatchObject({
      code: "forbidden",
    });
    await expect(
      files.write("m1", "escape/new.txt", "not allowed")
    ).rejects.toMatchObject({ code: "forbidden" });
    await expect(
      readFile(path.join(outside, "secret.txt"), "utf-8")
    ).resolves.toBe("private");
    const tree = await files.list("m1", "");
    expect(tree.entries.some((entry) => entry.path === "escape")).toBeFalsy();
    await unlink(path.join(files.root("m1"), "escape"));
  });
});
