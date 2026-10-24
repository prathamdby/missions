import { existsSync } from "node:fs";
import { readFile, rename, symlink, writeFile } from "node:fs/promises";
import path from "node:path";

import type { Project } from "@missions/protocol/projects";
import { afterEach, describe, expect, it, vi } from "vitest";

import { openDatabase } from "../db/database";
import { OperationJournal } from "../db/journal";
import { Store } from "../db/store";
import { EventLog } from "../events/event-log";
import * as execution from "../lib/exec";
import { gitRepo, sh, tempDir } from "../test/fixtures";
import {
  cleanupBinding,
  slugify,
  verifyBinding,
  WorkspaceService,
} from "./workspace-service";

const setup = async () => {
  const store = new Store(openDatabase(":memory:"));
  const root = await tempDir("worktrees");
  const service = new WorkspaceService({
    journal: new OperationJournal(store, new EventLog(store)),
    settings: () => ({
      cleanupAfterMerge: false,
      defaultWorkspaceMode: "new_worktree",
      maxConcurrentWorkers: 2,
      orchestrator: { modelId: "m", reasoningEffort: null },
      worker: { modelId: "m", reasoningEffort: null },
      worktreeRoot: root,
    }),
  });
  const repo = await gitRepo("proj");
  const project: Project = {
    createdAt: new Date().toISOString(),
    defaultBranch: "main",
    id: "p1",
    kind: "git",
    name: "proj",
    path: repo,
    remoteUrl: null,
  };
  return { project, repo, root, service };
};

describe(slugify, () => {
  it("makes short branch-safe slugs", () => {
    expect(slugify("Fix the Login Bug!! (urgent)")).toBe(
      "fix-the-login-bug-urgent"
    );
    expect(slugify("***")).toBe("mission");
  });
});

describe(WorkspaceService, () => {
  afterEach(() => vi.restoreAllMocks());

  it("keeps a path whose canonical identity changed through a symlink", async () => {
    const { project, service } = await setup();
    const binding = await service.bind(
      "symlink000",
      project,
      { baseBranch: "main", mode: "new_worktree" },
      "symlink-op",
      "x"
    );
    await rename(binding.path, `${binding.path}-moved`);
    await symlink(`${binding.path}-moved`, binding.path);
    await expect(
      cleanupBinding(binding, { deleteBranch: true })
    ).resolves.toMatchObject({ removed: false });
    expect(existsSync(binding.path)).toBeTruthy();
  });

  it("never deletes a branch that advances between removal and ref deletion", async () => {
    const { project, repo, service } = await setup();
    const binding = await service.bind(
      "cas00000",
      project,
      { baseBranch: "main", mode: "new_worktree" },
      "cas-op",
      "x"
    );
    const reviewedHead = sh(binding.path, ["rev-parse", "HEAD"]);
    sh(repo, ["commit", "--allow-empty", "-qm", "external commit"]);
    const newer = sh(repo, ["rev-parse", "HEAD"]);
    const original = execution.git;
    vi.spyOn(execution, "git").mockImplementation(
      async (cwd, args, options) => {
        if (args[0] === "update-ref" && args[1] === "-d") {
          sh(repo, ["update-ref", `refs/heads/${binding.branch}`, newer]);
        }
        return await original(cwd, args, options);
      }
    );
    await expect(
      cleanupBinding(binding, { deleteBranch: true, mergedHead: reviewedHead })
    ).resolves.toMatchObject({ branchDeleted: false, removed: true });
    expect(sh(repo, ["rev-parse", `refs/heads/${binding.branch}`])).toBe(newer);
  });

  it("protects both endpoints of an existing rename and fails closed on status errors", async () => {
    const { project, repo, service } = await setup();
    sh(repo, ["mv", "README.md", "renamed.md"]);
    const binding = await service.bind(
      "rename-baseline",
      project,
      { acknowledgeDirty: true, mode: "current_checkout" },
      "rename-op",
      "x"
    );
    expect(binding.baselineDirtyFiles.toSorted()).toStrictEqual([
      "README.md",
      "renamed.md",
    ]);
    await writeFile(path.join(repo, ".git", "index"), "corrupt index");
    await expect(
      service.bind(
        "bad-status",
        project,
        { acknowledgeDirty: true, mode: "current_checkout" },
        "bad-status-op",
        "x"
      )
    ).rejects.toMatchObject({ code: "conflict" });
  });

  it("refuses cleanup after a branch switch or a changed canonical repository identity", async () => {
    const { project, service } = await setup();
    const binding = await service.bind(
      "identity000",
      project,
      { baseBranch: "main", mode: "new_worktree" },
      "identity-op",
      "x"
    );
    sh(binding.path, ["switch", "-qc", "other"]);
    await expect(
      cleanupBinding(binding, {
        deleteBranch: true,
        mergedHead: sh(binding.path, ["rev-parse", "HEAD"]),
      })
    ).resolves.toMatchObject({ removed: false });
    expect(existsSync(binding.path)).toBeTruthy();
    sh(binding.path, ["switch", "-q", binding.branch ?? ""]);
    await expect(
      cleanupBinding(
        { ...binding, repoRoot: "/different/repository" },
        { deleteBranch: true }
      )
    ).resolves.toMatchObject({ removed: false });
    await expect(
      cleanupBinding(binding, {
        deleteBranch: true,
        expectedHead: "0".repeat(40),
      })
    ).resolves.toMatchObject({ removed: false });
  });

  it("creates one owned worktree and branch for a new mission", async () => {
    const { project, root, service } = await setup();
    const binding = await service.bind(
      "abcdef12-0000",
      project,
      { baseBranch: "main", mode: "new_worktree" },
      "op-ws-1",
      "Add search"
    );
    expect(binding).toMatchObject({
      baseRef: "main",
      baselineDirtyFiles: [],
      branch: "missions/add-search-abcdef",
      mode: "new_worktree",
      owned: true,
    });
    expect(binding.path.startsWith(root)).toBeTruthy();
    expect(sh(binding.path, ["branch", "--show-current"])).toBe(
      "missions/add-search-abcdef"
    );
    await expect(verifyBinding(binding)).resolves.toStrictEqual([]);
  });

  it("requires acknowledgement for a dirty checkout and records the baseline", async () => {
    const { project, repo, service } = await setup();
    await writeFile(path.join(repo, "notes.txt"), "mine\n");
    await expect(
      service.bind("m2", project, { mode: "current_checkout" }, "op-ws-2", "x")
    ).rejects.toThrow(/uncommitted/u);
    const binding = await service.bind(
      "m2",
      project,
      { acknowledgeDirty: true, mode: "current_checkout" },
      "op-ws-3",
      "x"
    );
    expect(binding).toMatchObject({
      baselineDirtyFiles: ["notes.txt"],
      owned: false,
      path: repo,
    });
  });

  it("detects a moved folder or switched branch instead of rebinding", async () => {
    const { project, service } = await setup();
    const binding = await service.bind(
      "cafe0000",
      project,
      { baseBranch: "main", mode: "new_worktree" },
      "op-ws-4",
      "Move"
    );
    sh(binding.path, ["switch", "-q", "-c", "other"]);
    await expect(verifyBinding(binding)).resolves.toStrictEqual([
      `Expected branch ${binding.branch}, found other`,
    ]);
    await rename(binding.path, `${binding.path}-moved`);
    await expect(verifyBinding(binding)).resolves.toHaveLength(1);
  });

  it("never removes an unowned checkout", async () => {
    const { project, repo, service } = await setup();
    const current = await service.bind(
      "m5",
      project,
      { mode: "current_checkout" },
      "op-ws-5",
      "x"
    );
    await expect(
      cleanupBinding(current, { deleteBranch: true })
    ).resolves.toMatchObject({ removed: false });
    expect(existsSync(repo)).toBeTruthy();
  });

  it("keeps a dirty owned worktree with the user's edits intact", async () => {
    const { project, service } = await setup();
    const owned = await service.bind(
      "beef0000",
      project,
      { baseBranch: "main", mode: "new_worktree" },
      "op-ws-6",
      "Clean"
    );
    await writeFile(path.join(owned.path, "work.txt"), "unsaved\n");
    await expect(
      cleanupBinding(owned, { deleteBranch: true })
    ).resolves.toMatchObject({ removed: false });
    await expect(
      readFile(path.join(owned.path, "work.txt"), "utf-8")
    ).resolves.toBe("unsaved\n");
  });

  it("removes a clean owned worktree but keeps an unmerged branch", async () => {
    const { project, repo, service } = await setup();
    const owned = await service.bind(
      "feed0000",
      project,
      { baseBranch: "main", mode: "new_worktree" },
      "op-ws-7",
      "Done"
    );
    await writeFile(path.join(owned.path, "work.txt"), "done\n");
    sh(owned.path, ["add", "work.txt"]);
    sh(owned.path, ["commit", "-q", "-m", "work"]);
    await expect(
      cleanupBinding(owned, { deleteBranch: true })
    ).resolves.toMatchObject({ branchDeleted: false, removed: true });
    expect({
      branchKept: sh(repo, ["branch", "--list", owned.branch ?? ""]).includes(
        owned.branch ?? "?"
      ),
      folderGone: !existsSync(owned.path),
    }).toStrictEqual({ branchKept: true, folderGone: true });
  });
});
