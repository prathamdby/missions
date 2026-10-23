import {
  chmod,
  mkdir,
  stat,
  symlink,
  unlink,
  utimes,
  writeFile,
} from "node:fs/promises";
import path from "node:path";

import type { WorkspaceBinding } from "@missions/protocol/workspaces";
import { describe, expect, it } from "vitest";

import { gitRepo, sh, tempDir } from "../test/fixtures";
import { ArtifactStore } from "./artifact-store";
import {
  listWorkspaceDir,
  comparisonChanges,
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
  it("separates uncommitted, branch merge-base, and last-commit comparisons without changing the index", async () => {
    const dir = await gitRepo();
    const binding = bindingFor(dir);
    sh(dir, ["checkout", "-qb", "feature"]);
    await writeFile(path.join(dir, "feature.txt"), "committed feature\n");
    sh(dir, ["add", "feature.txt"]);
    sh(dir, ["commit", "-qm", "feature"]);
    sh(dir, ["checkout", "-q", "main"]);
    await writeFile(
      path.join(dir, "default-only.txt"),
      "default moved forward\n"
    );
    sh(dir, ["add", "default-only.txt"]);
    sh(dir, ["commit", "-qm", "advance default"]);
    sh(dir, ["checkout", "-q", "feature"]);
    await writeFile(path.join(dir, "dirty.txt"), "pending\n");
    const index = sh(dir, ["ls-files", "--stage"]);
    const pending = await comparisonChanges(binding, "uncommitted");
    const branch = await comparisonChanges(binding, "branch");
    const last = await comparisonChanges(binding, "last_commit");
    expect(pending.files.map((file) => file.path)).toStrictEqual(["dirty.txt"]);
    expect(branch.files.map((file) => file.path)).toStrictEqual([
      "feature.txt",
    ]);
    expect(last.files.map((file) => file.path)).toStrictEqual(["feature.txt"]);
    expect(branch.comparison).toStrictEqual({
      from: "main",
      mergeBase: true,
      mode: "branch",
      to: "feature",
    });
    expect(sh(dir, ["ls-files", "--stage"])).toBe(index);
  });

  it("fails closed on dirty submodule bytes instead of approving only their unchanged gitlink", async () => {
    const dir = await gitRepo();
    const child = await gitRepo("child");
    sh(dir, [
      "-c",
      "protocol.file.allow=always",
      "submodule",
      "add",
      "-q",
      child,
      "vendor",
    ]);
    sh(dir, ["commit", "-qm", "submodule"]);
    const binding = bindingFor(dir);
    await writeFile(
      path.join(dir, "vendor", "README.md"),
      "uncommitted nested bytes\n"
    );
    await expect(workspaceChanges(binding)).rejects.toMatchObject({
      code: "conflict",
    });
    const committed = await comparisonChanges(binding, "last_commit");
    expect(committed.files.map((file) => file.path)).toContain("vendor");
  });

  it("rejects canonical Git aliases for reads and artifact imports but allows ..notes", async () => {
    const dir = await gitRepo();
    await symlink(path.join(dir, ".git"), path.join(dir, "internal"));
    await writeFile(path.join(dir, "..notes"), "allowed");
    await expect(
      resolveWorkspacePath(dir, "internal/config")
    ).rejects.toMatchObject({ code: "forbidden" });
    await expect(
      readWorkspaceFile(bindingFor(dir), "..notes")
    ).resolves.toMatchObject({ content: "allowed" });
    const artifacts = new ArtifactStore(await tempDir("artifacts"));
    await expect(
      artifacts.import({
        agentId: null,
        createdAt: new Date().toISOString(),
        missionId: "m1",
        name: "config",
        source: path.join(dir, "internal/config"),
      })
    ).rejects.toMatchObject({ code: "forbidden" });
    const tree = await listWorkspaceDir(bindingFor(dir));
    expect(tree.entries.some((entry) => entry.path === "internal")).toBeFalsy();
  });

  it("binds binary bytes and the complete untracked tail even with restored timestamps", async () => {
    const dir = await gitRepo();
    const blob = path.join(dir, "blob.bin");
    await writeFile(blob, Buffer.from([0, 1, 2]));
    sh(dir, ["add", "blob.bin"]);
    sh(dir, ["commit", "-qm", "binary"]);
    const binding = bindingFor(dir);
    await writeFile(blob, Buffer.from([0, 2, 3]));
    const large = path.join(dir, "large.txt");
    await writeFile(large, `${"x".repeat(TEXT_LIMIT + 10)}a`);
    const stamp = await stat(large);
    const first = await workspaceChanges(binding);
    await writeFile(blob, Buffer.from([0, 3, 4]));
    const second = await workspaceChanges(binding);
    await writeFile(large, `${"x".repeat(TEXT_LIMIT + 10)}b`);
    await utimes(large, stamp.atime, stamp.mtime);
    const third = await workspaceChanges(binding);
    expect(second.hash).not.toBe(first.hash);
    expect(third.hash).not.toBe(second.hash);
    expect(third.files.find((file) => file.path === "large.txt")).toMatchObject(
      { additions: 1, truncated: true }
    );
    await chmod(large, 0o755);
    const executable = await workspaceChanges(binding);
    expect(executable.hash).not.toBe(third.hash);
  });

  it("truthfully marks line-budget truncation", async () => {
    const dir = await gitRepo();
    await writeFile(path.join(dir, "lines.txt"), "line\n".repeat(1600));
    const changes = await workspaceChanges(bindingFor(dir));
    expect(changes.files[0]).toMatchObject({
      additions: 1600,
      truncated: true,
    });
    expect(changes.files[0]?.hunks[0]?.lines).toHaveLength(1500);
  });

  it("keeps pending changes that cancel mission history and staged unborn files", async () => {
    const dir = await gitRepo();
    const binding = bindingFor(dir);
    await writeFile(path.join(dir, "README.md"), "mission\n");
    await writeFile(path.join(dir, "history.txt"), "committed\n");
    await writeFile(
      path.join(dir, "transient.txt"),
      "committed then deleted\n"
    );
    sh(dir, ["add", "."]);
    sh(dir, ["commit", "-qm", "mission"]);
    await writeFile(path.join(dir, "README.md"), "hello\n");
    await unlink(path.join(dir, "transient.txt"));
    const changes = await workspaceChanges(binding);
    expect(
      changes.files.map((file) => [file.path, file.committed])
    ).toStrictEqual([
      ["history.txt", true],
      ["README.md", false],
      ["transient.txt", false],
    ]);
    expect(
      changes.files[1]?.hunks[0]?.lines.some(
        (line) => line.text === "mission" && line.kind === "del"
      )
    ).toBeTruthy();
    const unborn = await tempDir("unborn");
    sh(unborn, ["init", "-q", "-b", "main"]);
    await writeFile(path.join(unborn, "staged.txt"), "staged\n");
    sh(unborn, ["add", "staged.txt"]);
    const initial = await workspaceChanges({
      ...binding,
      path: unborn,
      repoRoot: path.join(unborn, ".git"),
      startRevision: null,
    });
    expect(initial.files).toMatchObject([
      { committed: false, path: "staged.txt", status: "added" },
    ]);
  });

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
