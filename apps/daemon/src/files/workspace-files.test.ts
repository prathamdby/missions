import { mkdir, symlink, writeFile } from "node:fs/promises";
import path from "node:path";

import type { WorkspaceBinding } from "@missions/protocol/workspaces";
import { describe, expect, it } from "vitest";

import { gitRepo, sh, tempDir } from "../test/fixtures";
import {
  listWorkspaceDir,
  readWorkspaceFile,
  resolveWorkspacePath,
  TEXT_LIMIT,
  workspaceChanges,
} from "./workspace-files";

const bindingFor = (
  dir: string,
  baselineDirtyFiles: string[] = []
): WorkspaceBinding => ({
  baseRef: "main",
  baselineDirtyFiles,
  branch: "main",
  createdAt: new Date().toISOString(),
  id: "b1",
  missionId: "m1",
  mode: "current_checkout",
  owned: false,
  path: dir,
  projectId: "p1",
  repoRoot: path.join(dir, ".git"),
  startRevision: sh(dir, ["rev-parse", "HEAD"]),
});

describe("workspace files", () => {
  it("rejects traversal, absolute paths, git internals and symlink escapes", async () => {
    const dir = await gitRepo();
    const outside = await tempDir("outside");
    await writeFile(path.join(outside, "secret.txt"), "secret");
    await symlink(outside, path.join(dir, "escape"));
    const attempts = [
      "../x",
      "/etc/passwd",
      ".git/config",
      "escape/secret.txt",
      "a/../../x",
    ];
    const codes = await Promise.all(
      attempts.map(
        async (raw) =>
          await resolveWorkspacePath(dir, raw).then(
            () => "ok",
            (error: { code?: string }) => error.code
          )
      )
    );
    expect(codes).toStrictEqual([
      "forbidden",
      "forbidden",
      "forbidden",
      "forbidden",
      "forbidden",
    ]);
  });

  it("reads text, binary, missing and oversized files honestly", async () => {
    const dir = await gitRepo();
    await writeFile(
      path.join(dir, "image.png"),
      Buffer.from([0x89, 0x50, 0x00, 0x01])
    );
    await writeFile(path.join(dir, "big.txt"), "a".repeat(TEXT_LIMIT + 10));
    const binding = bindingFor(dir);
    const [text, binary, missing, big] = await Promise.all(
      ["README.md", "image.png", "gone.txt", "big.txt"].map((file) =>
        readWorkspaceFile(binding, file)
      )
    );
    expect(text).toMatchObject({ content: "hello\n", kind: "text" });
    expect(binary).toMatchObject({ kind: "binary", mediaType: "image/png" });
    expect(missing).toStrictEqual({ kind: "missing", path: "gone.txt" });
    expect(big).toMatchObject({ kind: "text", truncated: true });
  });

  it("reports shared changes, untracked and binary files, and flags pre-existing edits", async () => {
    const dir = await gitRepo();
    await writeFile(path.join(dir, "README.md"), "hello\nworld\n");
    const binding = bindingFor(dir, ["README.md"]);
    await mkdir(path.join(dir, "src"));
    await writeFile(path.join(dir, "src", "new.ts"), "export const a = 1;\n");
    await writeFile(path.join(dir, "blob.bin"), Buffer.from([0, 1, 2]));
    const changes = await workspaceChanges(binding);
    expect(
      changes.files.map((file) => [
        file.path,
        file.status,
        file.preExisting,
        file.binary,
      ])
    ).toStrictEqual([
      ["blob.bin", "untracked", false, true],
      ["README.md", "modified", true, false],
      ["src/new.ts", "untracked", false, false],
    ]);
    expect(
      changes.files[1]?.hunks[0]?.lines.map((line) => line.kind)
    ).toStrictEqual(["context", "add"]);
    await writeFile(path.join(dir, "src", "new.ts"), "export const a = 2;\n");
    const after = await workspaceChanges(binding);
    expect(after.hash).not.toBe(changes.hash);
  });

  it("lists one folder level with change markers and hides .git", async () => {
    const dir = await gitRepo();
    await mkdir(path.join(dir, "src"));
    await writeFile(path.join(dir, "src", "new.ts"), "x\n");
    const tree = await listWorkspaceDir(bindingFor(dir));
    expect(tree.entries).toStrictEqual([
      { change: "modified", path: "src", type: "directory" },
      { change: null, path: "README.md", type: "file" },
    ]);
  });
});
