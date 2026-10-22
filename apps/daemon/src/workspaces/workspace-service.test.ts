import { existsSync } from "node:fs";
import { readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

import type { Project } from "@missions/protocol/projects";
import { describe, expect, it } from "vitest";

import { openDatabase } from "../db/database";
import { OperationJournal } from "../db/journal";
import { Store } from "../db/store";
import { EventLog } from "../events/event-log";
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
      defaultAutonomy: "medium",
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
