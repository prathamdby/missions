import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import {
  readdir,
  readFile,
  rename,
  writeFile,
  mkdir,
  rm,
  symlink,
} from "node:fs/promises";
import path from "node:path";

import type { DaemonEvent } from "@missions/protocol/events";
import type { PlanRevision } from "@missions/protocol/missions";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { Daemon } from "../daemon";
import { ArtifactStore } from "../files/artifact-store";
import { SharedFiles } from "../files/shared-files";
import * as execution from "../lib/exec";
import { ProcessRecordRepository } from "../processes/process-record-repository";
import { ProcessSupervisor } from "../processes/process-supervisor";
import type { StopResult } from "../processes/process-supervisor";
import { sh, testConfig } from "../test/fixtures";
import {
  bootDaemon,
  control,
  MODEL,
  pausedMission,
  outcome,
  RAW_MODELS,
  startMission,
  waitFor,
} from "../test/mission-harness";

const opened: Daemon[] = [];

const notice = (message: string) =>
  ({
    data: {
      notice: { code: "info", level: "info", message, retryAfterMs: null },
    },
    type: "notice",
  }) as const;

const OWNED_ROWS = {
  agents: "SELECT COUNT(*) AS n FROM agents WHERE mission_id = ?",
  artifacts: "SELECT COUNT(*) AS n FROM artifacts WHERE mission_id = ?",
  assignments: "SELECT COUNT(*) AS n FROM assignments WHERE mission_id = ?",
  events: "SELECT COUNT(*) AS n FROM events WHERE stream = ?",
  missions: "SELECT COUNT(*) AS n FROM missions WHERE id = ?",
  operations: "SELECT COUNT(*) AS n FROM operations WHERE mission_id = ?",
  permissions: "SELECT COUNT(*) AS n FROM permissions WHERE mission_id = ?",
  plans: "SELECT COUNT(*) AS n FROM plans WHERE mission_id = ?",
  questions: "SELECT COUNT(*) AS n FROM questions WHERE mission_id = ?",
  queueItems: "SELECT COUNT(*) AS n FROM queue_items WHERE mission_id = ?",
  todos: "SELECT COUNT(*) AS n FROM todos WHERE mission_id = ?",
  transcript: "SELECT COUNT(*) AS n FROM transcript WHERE mission_id = ?",
} as const;

const rowCounts = (daemon: Daemon, missionId: string, agentIds: string[]) => ({
  ...Object.fromEntries(
    Object.entries(OWNED_ROWS).map(([table, sql]) => [
      table,
      (
        daemon.store.handle.sqlite.prepare(sql).get(missionId) as {
          n: number;
        }
      ).n,
    ])
  ),
  processRecords: new ProcessRecordRepository(daemon.store).list(agentIds)
    .length,
});

const removedEvents = (daemon: Daemon, missionId: string) =>
  daemon.log
    .replay(null, 0, 10_000)
    .filter(
      (event) =>
        event.type === "mission.removed" && event.data.missionId === missionId
    );

/** Fills every mission-owned table so a purge can be checked for completeness. */
const seedOwnedRows = (daemon: Daemon, missionId: string, agentId: string) => {
  const { store } = daemon;
  const at = new Date().toISOString();
  const plan: PlanRevision = {
    actionable: false,
    agentId,
    createdAt: at,
    decidedAt: null,
    epoch: 0,
    feedback: null,
    guidanceVersion: null,
    id: `${missionId}:plan`,
    markdown: "1. Write",
    missionId,
    revision: 1,
    sessionId: null,
    status: "superseded",
    title: "Plan",
    toolUseId: null,
  };
  store.plans.put(plan);
  store.todos.put({
    agentId,
    content: "Explore",
    id: `${missionId}:todo`,
    missionId,
    position: 0,
    priority: "high",
    status: "pending",
  });
  store.questions.put({
    agentId,
    answers: null,
    createdAt: at,
    epoch: 0,
    id: `${missionId}:question`,
    missionId,
    questions: [],
    status: "cancelled",
  });
  store.permissions.put({
    agentId,
    allowAlways: false,
    createdAt: at,
    decidedAt: at,
    decision: null,
    epoch: 0,
    id: `${missionId}:permission`,
    kind: "tool",
    missionId,
    reason: null,
    status: "cancelled",
    toolUses: [],
  });
  store.assignments.put({
    createdAt: at,
    epoch: 0,
    handoff: null,
    id: `${missionId}:assignment`,
    instructions: "Do it",
    missionId,
    needsWrite: false,
    status: "cancelled",
    title: "Task",
    updatedAt: at,
    workerAgentId: null,
  });
  store.artifacts.put({
    agentId,
    createdAt: at,
    id: `${missionId}-artifact`,
    kind: "file",
    mediaType: "text/plain",
    missionId,
    name: "notes.txt",
    size: 5,
  });
  store.appendTranscript({
    agentId,
    createdAt: at,
    id: `${missionId}:transcript`,
    isError: false,
    kind: "system",
    missionId,
    purpose: null,
    recipient: null,
    requestId: null,
    sender: null,
    text: "hello",
    toolName: null,
    toolUseId: null,
  });
  new ProcessRecordRepository(store).save(
    { agentId, pid: 999_999, startTime: "", tag: `${agentId}.gone` },
    agentId
  );
};

const agentIdsOf = (daemon: Daemon, missionId: string) =>
  daemon.store.listAgents(missionId).map((agent) => agent.id);

/** Every file outside `.git` with its content, plus the repository's refs. */
const workspaceState = async (repo: string) => {
  const files = await readdir(repo, { recursive: true, withFileTypes: true });
  const contents = await Promise.all(
    files
      .filter(
        (entry) =>
          entry.isFile() &&
          !path
            .relative(repo, entry.parentPath)
            .split(path.sep)
            .includes(".git")
      )
      .map(async (entry) => {
        const file = path.join(entry.parentPath, entry.name);
        return [path.relative(repo, file), await readFile(file, "utf-8")];
      })
  );
  return {
    files: Object.fromEntries(contents.toSorted()),
    head: sh(repo, ["rev-parse", "HEAD"]),
    refs: sh(repo, ["for-each-ref", "--format=%(refname) %(objectname)"]),
  };
};

/** Holds a deletion inside the workspace gate until released. */
const holdDeletion = (daemon: Daemon, missionId: string) => {
  const [agentId] = agentIdsOf(daemon, missionId);
  if (!agentId) {
    throw new Error("Missing agent");
  }
  new ProcessRecordRepository(daemon.store).save(
    { agentId, pid: 999_999, startTime: "", tag: `${agentId}.held` },
    agentId
  );
  const entered = Promise.withResolvers<undefined>();
  const release = Promise.withResolvers<StopResult>();
  vi.spyOn(daemon.supervisor, "inspectRecord").mockImplementation(async () => {
    entered.resolve(undefined);
    return await release.promise;
  });
  return {
    entered: entered.promise,
    release: () => release.resolve({ stopped: true, survivors: [] }),
  };
};

const settledProcesses = (daemon: Daemon) =>
  vi
    .spyOn(daemon.supervisor, "inspectRecord")
    .mockResolvedValue({ stopped: true, survivors: [] });

const ownedMission = async () => {
  const ctx = await pausedMission(await bootDaemon(opened));
  const workspace = await ctx.daemon.workspaces.bind(
    ctx.missionId,
    ctx.daemon.projects.get(ctx.projectId),
    { baseBranch: "main", mode: "new_worktree" },
    "owned-delete-worktree",
    "Delete owned files"
  );
  ctx.daemon.missions.patch(ctx.missionId, (mission) => ({
    ...mission,
    workspace,
  }));
  return { ...ctx, workspace };
};

const removeOwned = (ctx: Awaited<ReturnType<typeof ownedMission>>) =>
  ctx.daemon.missions.remove(
    ctx.missionId,
    control(ctx.daemon, ctx.missionId, "delete-owned-worktree")
  );

describe("mission deletion", () => {
  afterEach(async () => {
    vi.restoreAllMocks();
    await Promise.all(opened.splice(0).map((daemon) => daemon.close()));
  });

  it("purges mission rows and files but keeps grants, other missions and the current checkout", async () => {
    const booted = await bootDaemon(opened);
    const ctx = await pausedMission(booted);
    const other = await pausedMission(booted, "2");
    const agentIds = agentIdsOf(ctx.daemon, ctx.missionId);
    const [agentId] = agentIds;
    if (!agentId) {
      throw new Error("Missing agent");
    }
    seedOwnedRows(ctx.daemon, ctx.missionId, agentId);
    const otherAgents = agentIdsOf(ctx.daemon, other.missionId);
    seedOwnedRows(ctx.daemon, other.missionId, otherAgents[0] ?? "");
    ctx.daemon.store.putGrant({
      action: "execute",
      createdAt: new Date().toISOString(),
      id: "grant-kept",
      normalizedRequest: "pnpm test",
      projectId: ctx.projectId,
      role: "orchestrator",
      workspacePath: ctx.repo,
    });
    const artifactFile = path.join(
      ctx.config.artifactsDir,
      ctx.missionId,
      `${ctx.missionId}-artifact.txt`
    );
    const sharedFile = path.join(
      ctx.config.home,
      "shared",
      ctx.missionId,
      "results",
      "summary.md"
    );
    await mkdir(path.dirname(artifactFile), { recursive: true });
    await writeFile(artifactFile, "notes");
    await mkdir(path.dirname(sharedFile), { recursive: true });
    await writeFile(sharedFile, "done");
    await writeFile(path.join(ctx.repo, "work.txt"), "uncommitted\n");
    const workspaceBefore = await workspaceState(ctx.repo);
    const before = rowCounts(ctx.daemon, ctx.missionId, agentIds);
    expect(Object.values(before).every((count) => count > 0)).toBeTruthy();
    const otherBefore = rowCounts(ctx.daemon, other.missionId, otherAgents);
    const inspect = settledProcesses(ctx.daemon);
    const seen: DaemonEvent[] = [];
    ctx.daemon.log.subscribe((event) => seen.push(event));

    const result = await outcome(() =>
      ctx.daemon.missions.remove(
        ctx.missionId,
        control(ctx.daemon, ctx.missionId, "delete-mission-1")
      )
    );

    expect({
      events: seen,
      inspected: inspect.mock.calls.map(([record]) => record.tag),
      listed: ctx.daemon.missions.list().map((mission) => mission.id),
      read: await outcome(() => ctx.daemon.missions.get(ctx.missionId)),
      receipt: ctx.daemon.store.getOperation("delete-mission-1"),
      result,
      rows: rowCounts(ctx.daemon, ctx.missionId, agentIds),
    }).toStrictEqual({
      events: [
        expect.objectContaining({
          data: { missionId: ctx.missionId },
          missionId: null,
          type: "mission.removed",
        }),
      ],
      inspected: expect.arrayContaining([`${agentId}.gone`]),
      listed: [other.missionId],
      read: "not_found: Mission not found",
      receipt: {
        operation: expect.objectContaining({
          detail: {},
          kind: "mission.delete",
          missionId: ctx.missionId,
          status: "succeeded",
        }),
        result: null,
      },
      result: "accepted",
      rows: {
        agents: 0,
        artifacts: 0,
        assignments: 0,
        events: 0,
        missions: 0,
        // Only the minimal receipt that answers a retried request remains.
        operations: 1,
        permissions: 0,
        plans: 0,
        processRecords: 0,
        questions: 0,
        queueItems: 0,
        todos: 0,
        transcript: 0,
      },
    });
    expect({
      artifact: existsSync(artifactFile),
      grants: ctx.daemon.store.listGrants().map((grant) => grant.id),
      otherRows: rowCounts(ctx.daemon, other.missionId, otherAgents),
      shared: existsSync(sharedFile),
      workspace: await workspaceState(ctx.repo),
    }).toStrictEqual({
      artifact: false,
      grants: expect.arrayContaining(["grant-kept"]),
      otherRows: otherBefore,
      shared: false,
      workspace: workspaceBefore,
    });
  });

  it.each([
    "merged",
    "unmerged",
    "remote",
    "dirty",
    "kept",
    "missing",
  ] as const)(
    "removes a %s owned worktree and preserves commits when needed",
    async (kind) => {
      const ctx = await ownedMission();
      const { workspace } = ctx;
      if (kind === "unmerged" || kind === "remote" || kind === "merged") {
        sh(workspace.path, [
          "commit",
          "--allow-empty",
          "-qm",
          "mission commit",
        ]);
      }
      if (kind === "merged") {
        sh(ctx.repo, ["merge", "--ff-only", workspace.branch ?? ""]);
      }
      if (kind === "remote") {
        sh(ctx.repo, [
          "update-ref",
          "refs/remotes/origin/saved",
          sh(workspace.path, ["rev-parse", "HEAD"]),
        ]);
      }
      if (kind === "dirty") {
        await writeFile(path.join(workspace.path, "dirty.txt"), "discard me");
      }
      if (kind === "kept") {
        ctx.daemon.missions.patch(ctx.missionId, (mission) => ({
          ...mission,
          publish: { ...mission.publish, cleanup: "kept" },
        }));
      }
      if (kind === "missing") {
        await rm(workspace.path, { force: true, recursive: true });
      }
      const result = await removeOwned(ctx);
      expect({
        project: existsSync(path.join(ctx.repo, "README.md")),
        status: result.status,
        worktree: existsSync(workspace.path),
      }).toStrictEqual({ project: true, status: "accepted", worktree: false });
      expect(sh(ctx.repo, ["worktree", "list", "--porcelain"])).not.toContain(
        workspace.path
      );
      const branches = sh(ctx.repo, [
        "for-each-ref",
        "--format=%(refname)",
        `refs/heads/${workspace.branch}`,
      ]);
      expect(Boolean(branches)).toBe(kind === "unmerged");
      expect(result.notice).toBe(
        kind === "unmerged"
          ? `Kept branch ${workspace.branch} because it has commits that are neither merged into the base branch nor in a local remote-tracking ref.`
          : undefined
      );
      await expect(
        ctx.daemon.missions.remove(ctx.missionId, {
          expectedRevision: 0,
          operationId: "delete-owned-worktree",
        })
      ).resolves.toStrictEqual({
        ...result,
        status: "duplicate",
      });
    }
  );

  it.each([true, false])(
    "with the repository gone, removes only an identity-checked folder (valid=%s)",
    async (valid) => {
      const ctx = await ownedMission();
      await rename(ctx.repo, `${ctx.repo}-gone`);
      if (!valid) {
        await writeFile(
          path.join(ctx.workspace.path, ".git"),
          "gitdir: /tmp/unrelated/worktrees/other\n"
        );
      }
      const result = await outcome(() => removeOwned(ctx));
      expect(result).toBe(
        valid
          ? "accepted"
          : "conflict: The repository is gone and the worktree identity cannot be verified"
      );
      expect(existsSync(ctx.workspace.path)).toBe(!valid);
      expect(
        ctx.daemon.missions
          .list()
          .some((mission) => mission.id === ctx.missionId)
      ).toBe(!valid);
    }
  );

  it("refuses owned-worktree removal while another mission runs there", async () => {
    const ctx = await ownedMission();
    const other = await ctx.daemon.missions.create({
      goal: "Use the shared worktree",
      operationId: "create-sharing-mission",
      orchestrator: MODEL,
      projectId: ctx.projectId,
      worker: MODEL,
      workspace: { mode: "existing_worktree", path: ctx.workspace.path },
    });
    await waitFor(
      () =>
        ctx.runtimes.some(
          (runtime) =>
            runtime.options.agentId === other.agents[0]?.id &&
            runtime.submitted.length > 0
        ),
      Boolean
    );
    const file = path.join(ctx.workspace.path, "other-mission.txt");
    await writeFile(file, "other mission's uncommitted work");
    await expect(removeOwned(ctx)).rejects.toThrow(
      /still owns this workspace/u
    );
    await expect(readFile(file, "utf-8")).resolves.toBe(
      "other mission's uncommitted work"
    );
    expect(ctx.daemon.missions.get(ctx.missionId).workspace?.path).toBe(
      ctx.workspace.path
    );
    await ctx.daemon.missions.pause(
      other.mission.id,
      control(ctx.daemon, other.mission.id, "pause-sharing-mission")
    );
    await expect(removeOwned(ctx)).resolves.toMatchObject({
      status: "accepted",
    });
    expect(ctx.daemon.missions.get(other.mission.id).status).toBe("paused");
  });

  it("refuses removal when another mission has uncertain processes in the workspace", async () => {
    const ctx = await ownedMission();
    const other = await pausedMission(ctx, "other-owner");
    ctx.daemon.missions.patch(other.missionId, (mission) => ({
      ...mission,
      status: "stop_failed",
      workspace: {
        ...ctx.workspace,
        missionId: other.missionId,
        mode: "existing_worktree",
        owned: false,
      },
    }));
    await expect(removeOwned(ctx)).rejects.toThrow(
      /processes still own this workspace/u
    );
    expect(existsSync(ctx.workspace.path)).toBeTruthy();
    ctx.daemon.missions.patch(other.missionId, (mission) => ({
      ...mission,
      status: "paused",
    }));
    await expect(removeOwned(ctx)).resolves.toMatchObject({
      status: "accepted",
    });
  });

  it.each([false, true])(
    "ignores unrelated missing worktree folders (own folder missing=%s)",
    async (missing) => {
      const ctx = await ownedMission();
      const unrelated = `${ctx.repo}-unrelated`;
      sh(ctx.repo, ["worktree", "add", "-b", "unrelated", unrelated, "main"]);
      await rm(unrelated, { force: true, recursive: true });
      if (missing) {
        await rm(ctx.workspace.path, { force: true, recursive: true });
      }
      await expect(removeOwned(ctx)).resolves.toMatchObject({
        status: "accepted",
      });
      expect(existsSync(ctx.workspace.path)).toBeFalsy();
      expect(
        sh(ctx.repo, [
          "for-each-ref",
          "--format=%(refname)",
          `refs/heads/${ctx.workspace.branch}`,
        ])
      ).toBe("");
    }
  );

  it.each(["shared", "artifacts"])(
    "continues process recovery when the %s sweep cannot list its root",
    async (kind) => {
      const ctx = await pausedMission(await bootDaemon(opened));
      const root =
        kind === "shared"
          ? path.join(ctx.config.home, "shared")
          : ctx.config.artifactsDir;
      await mkdir(root, { recursive: true });
      const record = {
        agentId: "recorded-orphan",
        pid: 999_999,
        startTime: "",
        tag: "recorded-orphan.gone",
      };
      new ProcessRecordRepository(ctx.daemon.store).save(
        record,
        record.agentId
      );
      await ctx.daemon.close();
      await rename(root, `${root}-saved`);
      await writeFile(root, "not a directory");
      const stop = vi
        .spyOn(ProcessSupervisor.prototype, "stopRecord")
        .mockResolvedValue({ stopped: true, survivors: [] });
      const log = vi.spyOn(process.stderr, "write").mockReturnValue(true);
      const restarted = await bootDaemon(opened, ctx.config);
      expect(stop).toHaveBeenCalledWith(record);
      expect(
        new ProcessRecordRepository(restarted.daemon.store).list()
      ).toStrictEqual([]);
      expect(log.mock.calls.map(([line]) => line).join("")).toContain(
        "Mission folder cleanup failed"
      );
      expect(restarted.daemon.missions.get(ctx.missionId).id).toBe(
        ctx.missionId
      );
    }
  );

  it.each([1, null])(
    "leaves the mission readable and retryable when git removal fails with %s",
    async (code) => {
      const ctx = await ownedMission();
      const original = execution.git;
      const git = vi
        .spyOn(execution, "git")
        .mockImplementation(async (cwd, args, options) =>
          args[0] === "worktree" && args[1] === "remove"
            ? {
                code,
                missing: false,
                ok: false,
                stderr: "removal failed",
                stdout: "",
              }
            : await original(cwd, args, options)
        );
      await expect(removeOwned(ctx)).rejects.toMatchObject({
        code: "conflict",
        message: "removal failed",
      });
      expect(ctx.daemon.missions.get(ctx.missionId).workspace?.path).toBe(
        ctx.workspace.path
      );
      expect(existsSync(ctx.workspace.path)).toBeTruthy();
      git.mockRestore();
      await expect(removeOwned(ctx)).resolves.toMatchObject({
        status: "accepted",
      });
    }
  );

  it("retries after a purge failure even though the worktree and branch are already gone", async () => {
    const ctx = await ownedMission();
    vi.spyOn(ctx.daemon.journal, "recordCompleted").mockImplementationOnce(
      () => {
        throw new Error("disk full");
      }
    );
    await expect(removeOwned(ctx)).rejects.toThrow("disk full");
    expect(ctx.daemon.missions.get(ctx.missionId).id).toBe(ctx.missionId);
    expect(existsSync(ctx.workspace.path)).toBeFalsy();
    await expect(removeOwned(ctx)).resolves.toMatchObject({
      status: "accepted",
    });
  });

  it("never removes an existing worktree, even with a misleading owned flag", async () => {
    const ctx = await ownedMission();
    ctx.daemon.missions.patch(ctx.missionId, (mission) => ({
      ...mission,
      workspace: { ...ctx.workspace, mode: "existing_worktree" },
    }));
    await removeOwned(ctx);
    expect(existsSync(ctx.workspace.path)).toBeTruthy();
  });

  it("keeps a worktree whose path has been replaced with a symlink", async () => {
    const ctx = await ownedMission();
    await rename(ctx.workspace.path, `${ctx.workspace.path}-moved`);
    await symlink(`${ctx.workspace.path}-moved`, ctx.workspace.path);
    await expect(removeOwned(ctx)).rejects.toMatchObject({ code: "conflict" });
    expect(existsSync(ctx.workspace.path)).toBeTruthy();
  });

  it("logs file cleanup failures and sweeps only UUID folders with completed deletion receipts", async () => {
    const ctx = await pausedMission(await bootDaemon(opened));
    const roots = [
      path.join(ctx.config.home, "shared"),
      ctx.config.artifactsDir,
    ];
    const stray = randomUUID();
    const failed = randomUUID();
    const names = [ctx.missionId, stray, failed, "not-a-uuid"];
    await Promise.all(
      roots.flatMap((root) =>
        names.map(async (name) => {
          await mkdir(path.join(root, name), { recursive: true });
          await writeFile(path.join(root, name, "kept.txt"), "content");
        })
      )
    );
    const at = new Date().toISOString();
    ctx.daemon.store.putOperation({
      createdAt: at,
      detail: {},
      id: "failed-delete-receipt",
      kind: "mission.delete",
      missionId: failed,
      status: "failed",
      updatedAt: at,
    });
    ctx.daemon.journal.recordCompleted({
      id: "non-uuid-receipt",
      kind: "mission.delete",
      missionId: "not-a-uuid",
    });
    vi.spyOn(SharedFiles.prototype, "remove").mockRejectedValueOnce(
      new Error("shared blocked")
    );
    vi.spyOn(ArtifactStore.prototype, "remove").mockRejectedValueOnce(
      new Error("artifacts blocked")
    );
    const result = await ctx.daemon.missions.remove(
      ctx.missionId,
      control(ctx.daemon, ctx.missionId, "delete-sweep-receipt")
    );
    const warning =
      "Some Missions-owned files could not be removed. Cleanup will be retried when the daemon restarts.";
    expect({
      notice: result.notice,
      receipt: ctx.daemon.store.getOperation("delete-sweep-receipt")?.result,
      warnings: ctx.daemon.log
        .replay(null, 0, 10_000)
        .filter((event) => event.type === "notice")
        .map((event) => event.data.notice.message),
    }).toStrictEqual({
      notice: warning,
      receipt: { notice: warning },
      warnings: [
        `Mission ${ctx.missionId} file cleanup failed: shared blocked; artifacts blocked`,
      ],
    });
    expect(
      roots.every((root) => existsSync(path.join(root, ctx.missionId)))
    ).toBeTruthy();
    await ctx.daemon.close();
    const restarted = await bootDaemon(opened, ctx.config);
    await expect(
      restarted.daemon.missions.remove(ctx.missionId, {
        expectedRevision: 0,
        operationId: "delete-sweep-receipt",
      })
    ).resolves.toStrictEqual({ ...result, status: "duplicate" });
    for (const root of roots) {
      expect(existsSync(path.join(root, ctx.missionId))).toBeFalsy();
      expect(
        names.slice(1).every((name) => existsSync(path.join(root, name)))
      ).toBeTruthy();
    }
  });

  it("joins cleanup retries and preserves both branch and file warnings", async () => {
    const ctx = await ownedMission();
    sh(ctx.workspace.path, ["commit", "--allow-empty", "-qm", "unmerged work"]);
    const entered = Promise.withResolvers<undefined>();
    const finish = Promise.withResolvers<undefined>();
    vi.spyOn(SharedFiles.prototype, "remove").mockImplementationOnce(
      async () => {
        entered.resolve(undefined);
        await finish.promise;
        throw new Error("shared blocked");
      }
    );
    const first = removeOwned(ctx);
    await entered.promise;
    const retry = ctx.daemon.missions.remove(ctx.missionId, {
      expectedRevision: 0,
      operationId: "delete-owned-worktree",
    });
    finish.resolve(undefined);
    const result = await first;
    expect(result.notice).toContain(`Kept branch ${ctx.workspace.branch}`);
    expect(result.notice).toContain(
      "Some Missions-owned files could not be removed"
    );
    await expect(retry).resolves.toStrictEqual({
      ...result,
      status: "duplicate",
    });
    expect(
      ctx.daemon.store.getOperation("delete-owned-worktree")?.result
    ).toStrictEqual({ notice: result.notice });
    expect(removedEvents(ctx.daemon, ctx.missionId)).toHaveLength(1);
  });

  it("rolls back a failure inside the transaction and leaves the mission intact", async () => {
    const ctx = await pausedMission(await bootDaemon(opened));
    const agentIds = agentIdsOf(ctx.daemon, ctx.missionId);
    seedOwnedRows(ctx.daemon, ctx.missionId, agentIds[0] ?? "");
    settledProcesses(ctx.daemon);
    const before = rowCounts(ctx.daemon, ctx.missionId, agentIds);
    const mission = ctx.daemon.missions.get(ctx.missionId);
    const seen: DaemonEvent[] = [];
    ctx.daemon.log.subscribe((event) => seen.push(event));
    vi.spyOn(ctx.daemon.journal, "recordCompleted").mockImplementationOnce(
      () => {
        throw new Error("disk full");
      }
    );
    const request = control(ctx.daemon, ctx.missionId, "delete-rollback");

    const failed = await outcome(() =>
      ctx.daemon.missions.remove(ctx.missionId, request)
    );

    expect({
      events: seen,
      failed,
      mission: ctx.daemon.missions.get(ctx.missionId),
      receipt: ctx.daemon.store.getOperation(request.operationId),
      rows: rowCounts(ctx.daemon, ctx.missionId, agentIds),
    }).toStrictEqual({
      events: [],
      failed: "disk full",
      mission,
      receipt: null,
      rows: before,
    });
    // The stream fence was rolled back with the purge.
    ctx.daemon.log.publish(ctx.missionId, notice("still here"));
    const retried = control(ctx.daemon, ctx.missionId, "delete-rollback");
    await expect(
      outcome(() => ctx.daemon.missions.remove(ctx.missionId, retried))
    ).resolves.toBe("accepted");
  });

  it("answers a lost-response retry as duplicate, also after restart, and 404s new operation IDs", async () => {
    const config = await testConfig();
    const ctx = await pausedMission(await bootDaemon(opened, config));
    const request = control(ctx.daemon, ctx.missionId, "delete-restart");
    const removeWith = (daemon: Daemon, operationId: string) => () =>
      daemon.missions.remove(ctx.missionId, { ...request, operationId });
    const first = await outcome(removeWith(ctx.daemon, "delete-restart"));
    const duplicate = await ctx.daemon.missions.remove(ctx.missionId, request);
    const fresh = await outcome(removeWith(ctx.daemon, "delete-again"));
    await ctx.daemon.close();

    const restarted = await bootDaemon(opened, config);
    expect({
      afterRestart: [
        await outcome(removeWith(restarted.daemon, "delete-restart")),
        await outcome(removeWith(restarted.daemon, "delete-after-restart")),
        await outcome(() =>
          restarted.daemon.log.publish(ctx.missionId, notice("late"))
        ),
      ],
      beforeRestart: [first, duplicate, fresh],
      freshReceipt: restarted.daemon.store.getOperation("delete-after-restart"),
      removed: removedEvents(restarted.daemon, ctx.missionId).length,
    }).toStrictEqual({
      afterRestart: [
        "duplicate",
        "not_found: Mission not found",
        "not_found: Mission not found",
      ],
      beforeRestart: [
        "accepted",
        { operationId: "delete-restart", status: "duplicate" },
        "not_found: Mission not found",
      ],
      freshReceipt: null,
      removed: 1,
    });
  });

  it("rejects operation IDs used by another action or mission", async () => {
    const booted = await bootDaemon(opened);
    const ctx = await pausedMission(booted);
    const other = await pausedMission(booted, "2");
    settledProcesses(ctx.daemon);
    const removeWith = (missionId: string, operationId: string) => () =>
      ctx.daemon.missions.remove(
        missionId,
        control(ctx.daemon, missionId, operationId)
      );
    const reused = expect.stringMatching(
      /^conflict: .*different action or mission/u
    );
    expect([
      await outcome(removeWith(ctx.missionId, "pause-mission-1")),
      await outcome(removeWith(ctx.missionId, "delete-shared-id")),
      await outcome(removeWith(other.missionId, "delete-shared-id")),
      ctx.daemon.missions.get(other.missionId).status,
    ]).toStrictEqual([reused, "accepted", reused, "paused"]);
  });

  it("rejects a stale revision without touching the mission", async () => {
    const ctx = await pausedMission(await bootDaemon(opened));
    const agentIds = agentIdsOf(ctx.daemon, ctx.missionId);
    const before = rowCounts(ctx.daemon, ctx.missionId, agentIds);
    const { revision } = ctx.daemon.missions.get(ctx.missionId);
    await expect(
      ctx.daemon.missions.remove(ctx.missionId, {
        expectedRevision: revision - 1,
        operationId: "delete-stale",
      })
    ).rejects.toMatchObject({ code: "stale_revision" });
    expect(rowCounts(ctx.daemon, ctx.missionId, agentIds)).toStrictEqual(
      before
    );
    expect(ctx.daemon.store.getOperation("delete-stale")).toBeNull();
  });

  it("rejects active and stop_failed missions without stopping them", async () => {
    const booted = await bootDaemon(opened);
    const running = await startMission(booted);
    await expect(
      running.daemon.missions.remove(
        running.missionId,
        control(running.daemon, running.missionId, "delete-running")
      )
    ).rejects.toThrow(/running mission cannot be deleted/u);
    expect(running.orchestrator.closed).toBeFalsy();
    expect(running.daemon.missions.get(running.missionId).status).toBe(
      "running"
    );

    const failed = await startMission(booted, "2");
    failed.orchestrator.survivors = [4242];
    await failed.daemon.missions.pause(
      failed.missionId,
      control(failed.daemon, failed.missionId, "pause-stop-failed")
    );
    expect(failed.daemon.missions.get(failed.missionId).status).toBe(
      "stop_failed"
    );
    await expect(
      failed.daemon.missions.remove(
        failed.missionId,
        control(failed.daemon, failed.missionId, "delete-stop-failed")
      )
    ).rejects.toThrow(/did not stop/u);
  });

  it("rejects a pausing mission while its agents are still stopping", async () => {
    const ctx = await startMission(await bootDaemon(opened));
    const entered = Promise.withResolvers<undefined>();
    const release = Promise.withResolvers<undefined>();
    const close = ctx.orchestrator.close.bind(ctx.orchestrator);
    vi.spyOn(ctx.orchestrator, "close").mockImplementation(async () => {
      entered.resolve(undefined);
      await release.promise;
      return await close();
    });
    const pausing = ctx.daemon.missions.pause(
      ctx.missionId,
      control(ctx.daemon, ctx.missionId, "pause-slow")
    );
    await entered.promise;
    expect(ctx.daemon.missions.get(ctx.missionId).status).toBe("pausing");
    await expect(
      ctx.daemon.missions.remove(
        ctx.missionId,
        control(ctx.daemon, ctx.missionId, "delete-pausing")
      )
    ).rejects.toMatchObject({ code: "conflict" });
    release.resolve(undefined);
    await expect(pausing).resolves.toMatchObject({ status: "paused" });
  });

  it("requires settled operations and processes", async () => {
    const ctx = await pausedMission(await bootDaemon(opened));
    const at = new Date().toISOString();
    ctx.daemon.store.putOperation({
      createdAt: at,
      detail: { action: "remove" },
      id: "cleanup-uncertain",
      kind: "workspace.cleanup",
      missionId: ctx.missionId,
      status: "unknown",
      updatedAt: at,
    });
    await expect(
      ctx.daemon.missions.remove(
        ctx.missionId,
        control(ctx.daemon, ctx.missionId, "delete-unresolved")
      )
    ).rejects.toThrow(/unresolved outcome/u);
    ctx.daemon.journal.reconcile("cleanup-uncertain", "failed");

    const [agentId] = agentIdsOf(ctx.daemon, ctx.missionId);
    if (!agentId) {
      throw new Error("Missing agent");
    }
    new ProcessRecordRepository(ctx.daemon.store).save(
      { agentId, pid: 4242, startTime: "1", tag: `${agentId}.alive` },
      agentId
    );
    const signal = vi.spyOn(ctx.daemon.supervisor, "stopRecord");
    vi.spyOn(ctx.daemon.supervisor, "inspectRecord").mockResolvedValue({
      stopped: false,
      survivors: [4242],
    });
    await expect(
      ctx.daemon.missions.remove(
        ctx.missionId,
        control(ctx.daemon, ctx.missionId, "delete-alive")
      )
    ).rejects.toThrow(/still running: 4242/u);
    expect(signal).not.toHaveBeenCalled();
    expect(ctx.daemon.missions.get(ctx.missionId).status).toBe("paused");
    expect(
      new ProcessRecordRepository(ctx.daemon.store).list([agentId])
    ).toHaveLength(1);
  });

  it("refuses deletion when an agent process cannot be observed", async () => {
    const ctx = await pausedMission(await bootDaemon(opened));
    const [agentId] = agentIdsOf(ctx.daemon, ctx.missionId);
    if (!agentId) {
      throw new Error("Missing agent");
    }
    new ProcessRecordRepository(ctx.daemon.store).save(
      { agentId, pid: 4343, startTime: "1", tag: `${agentId}.unknown` },
      agentId
    );
    const signal = vi.spyOn(ctx.daemon.supervisor, "stopRecord");
    vi.spyOn(ctx.daemon.supervisor, "inspectRecord").mockResolvedValue({
      stopped: false,
      survivors: [],
      unobservable: true,
    });
    await expect(
      ctx.daemon.missions.remove(
        ctx.missionId,
        control(ctx.daemon, ctx.missionId, "delete-unobservable")
      )
    ).rejects.toThrow(/could not be confirmed stopped/u);
    expect(signal).not.toHaveBeenCalled();
    expect(ctx.daemon.missions.get(ctx.missionId).status).toBe("paused");
    expect(
      new ProcessRecordRepository(ctx.daemon.store).list([agentId])
    ).toHaveLength(1);
  });

  it("deletes a mission whose workspace directory is already gone", async () => {
    const ctx = await pausedMission(await bootDaemon(opened));
    await rename(ctx.repo, `${ctx.repo}-moved`);
    await expect(
      ctx.daemon.missions.remove(
        ctx.missionId,
        control(ctx.daemon, ctx.missionId, "delete-missing-dir")
      )
    ).resolves.toMatchObject({ status: "accepted" });
    await expect(
      readFile(path.join(`${ctx.repo}-moved`, "README.md"), "utf-8")
    ).resolves.toBe("hello\n");
  });

  it("joins a concurrent retry and rejects a concurrent different deletion", async () => {
    const ctx = await pausedMission(await bootDaemon(opened));
    const held = holdDeletion(ctx.daemon, ctx.missionId);
    const request = control(ctx.daemon, ctx.missionId, "delete-concurrent");
    const first = ctx.daemon.missions.remove(ctx.missionId, request);
    await held.entered;
    const retry = ctx.daemon.missions.remove(ctx.missionId, request);
    await expect(
      ctx.daemon.missions.remove(ctx.missionId, {
        ...request,
        operationId: "delete-competing",
      })
    ).rejects.toThrow(/already being deleted/u);
    held.release();
    await expect(first).resolves.toMatchObject({ status: "accepted" });
    await expect(retry).resolves.toMatchObject({ status: "duplicate" });
    expect(removedEvents(ctx.daemon, ctx.missionId)).toHaveLength(1);
  });

  it("wins over a later Resume and rejects an earlier one", async () => {
    const booted = await bootDaemon(opened);
    const ctx = await pausedMission(booted);
    const held = holdDeletion(ctx.daemon, ctx.missionId);
    const removing = ctx.daemon.missions.remove(
      ctx.missionId,
      control(ctx.daemon, ctx.missionId, "delete-before-resume")
    );
    await held.entered;
    await expect(
      ctx.daemon.missions.resume(
        ctx.missionId,
        control(ctx.daemon, ctx.missionId, "resume-during-delete")
      )
    ).rejects.toThrow(/being deleted/u);
    held.release();
    expect({
      removed: await outcome(() => removing),
      resumeAfter: await outcome(() =>
        ctx.daemon.missions.resume(ctx.missionId, {
          expectedRevision: 0,
          operationId: "resume-after-delete",
        })
      ),
      resumeReceipt: ctx.daemon.store.getOperation("resume-during-delete"),
      runtimes: ctx.runtimes.length,
    }).toStrictEqual({
      removed: "accepted",
      resumeAfter: "not_found: Mission not found",
      resumeReceipt: null,
      runtimes: 1,
    });

    const second = await pausedMission(booted, "2");
    const resuming = second.daemon.missions.resume(
      second.missionId,
      control(second.daemon, second.missionId, "resume-before-delete")
    );
    await expect(
      second.daemon.missions.remove(
        second.missionId,
        control(second.daemon, second.missionId, "delete-after-resume")
      )
    ).rejects.toMatchObject({ code: "conflict" });
    await expect(resuming).resolves.toMatchObject({ status: "running" });
  });

  it("rejects deletion during a model update and updates during deletion", async () => {
    const loading = Promise.withResolvers<unknown[]>();
    const ctx = await pausedMission(
      await bootDaemon(opened, undefined, () => loading.promise)
    );
    const updating = ctx.daemon.missions.update(ctx.missionId, {
      expectedRevision: ctx.daemon.missions.get(ctx.missionId).revision,
      orchestrator: { modelId: "next-model", reasoningEffort: "high" },
    });
    await expect(
      ctx.daemon.missions.remove(
        ctx.missionId,
        control(ctx.daemon, ctx.missionId, "delete-during-update")
      )
    ).rejects.toThrow(/still in progress/u);
    loading.resolve(RAW_MODELS);
    await expect(updating).resolves.toMatchObject({
      orchestrator: { modelId: "next-model" },
    });

    const held = holdDeletion(ctx.daemon, ctx.missionId);
    const removing = ctx.daemon.missions.remove(
      ctx.missionId,
      control(ctx.daemon, ctx.missionId, "delete-before-update")
    );
    await held.entered;
    await expect(
      ctx.daemon.missions.update(ctx.missionId, {
        expectedRevision: ctx.daemon.missions.get(ctx.missionId).revision,
        worker: { modelId: "next-model", reasoningEffort: "low" },
      })
    ).rejects.toThrow(/being deleted/u);
    held.release();
    await expect(removing).resolves.toMatchObject({ status: "accepted" });
  });

  it("serializes with publishing: in-flight publishes win, later ones are refused", async () => {
    const ctx = await pausedMission(await bootDaemon(opened));
    const journaled = Promise.withResolvers<undefined>();
    const finishPush = Promise.withResolvers<undefined>();
    const pushing = ctx.daemon.missions.withWorkspaceMutation(
      ctx.missionId,
      async () =>
        await ctx.daemon.journal.run(
          { id: "push-in-flight", kind: "git.push", missionId: ctx.missionId },
          async () => {
            journaled.resolve(undefined);
            await finishPush.promise;
            return "pushed";
          }
        )
    );
    await journaled.promise;
    await expect(
      ctx.daemon.missions.remove(
        ctx.missionId,
        control(ctx.daemon, ctx.missionId, "delete-during-push")
      )
    ).rejects.toThrow(/unresolved outcome/u);
    finishPush.resolve(undefined);
    await pushing;

    const entered = Promise.withResolvers<undefined>();
    const finish = Promise.withResolvers<undefined>();
    const publishing = ctx.daemon.missions.withWorkspaceMutation(
      ctx.missionId,
      async () => {
        entered.resolve(undefined);
        await finish.promise;
        return ctx.daemon.missions.patch(ctx.missionId, (mission) => ({
          ...mission,
          publish: { ...mission.publish, pushedBranch: "main" },
        }));
      }
    );
    await entered.promise;
    const removing = ctx.daemon.missions.remove(
      ctx.missionId,
      control(ctx.daemon, ctx.missionId, "delete-behind-publish")
    );
    await expect(
      ctx.daemon.publish.push(ctx.missionId, {
        expectedHead: "head",
        operationId: "push-during-delete",
      })
    ).rejects.toThrow(/being deleted/u);
    finish.resolve(undefined);
    await publishing;
    expect({
      pushReceipt: ctx.daemon.store.getOperation("push-during-delete"),
      pushedBranch: ctx.daemon.missions.get(ctx.missionId).publish.pushedBranch,
      removal: await outcome(() => removing),
      removed: removedEvents(ctx.daemon, ctx.missionId),
    }).toStrictEqual({
      pushReceipt: null,
      pushedBranch: "main",
      removal: expect.stringMatching(/^stale_revision: /u),
      removed: [],
    });
  });

  it("refuses cleanup during deletion and deletion with an uncertain cleanup", async () => {
    const booted = await bootDaemon(opened);
    const ctx = await pausedMission(booted);
    const held = holdDeletion(ctx.daemon, ctx.missionId);
    const removing = ctx.daemon.missions.remove(
      ctx.missionId,
      control(ctx.daemon, ctx.missionId, "delete-before-cleanup")
    );
    await held.entered;
    await expect(
      ctx.daemon.publish.cleanup(ctx.missionId, {
        action: "keep",
        operationId: "cleanup-during-delete",
      })
    ).rejects.toThrow(/being deleted/u);
    held.release();
    await expect(removing).resolves.toMatchObject({ status: "accepted" });
    expect(() =>
      ctx.daemon.publish.cleanup(ctx.missionId, {
        action: "keep",
        operationId: "cleanup-after-delete",
      })
    ).toThrow(/not found/u);

    const second = await pausedMission(booted, "2");
    const at = new Date().toISOString();
    second.daemon.store.putOperation({
      createdAt: at,
      detail: { action: "remove" },
      id: "cleanup-before-delete",
      kind: "workspace.cleanup",
      missionId: second.missionId,
      status: "intent",
      updatedAt: at,
    });
    await expect(
      second.daemon.missions.remove(
        second.missionId,
        control(second.daemon, second.missionId, "delete-after-cleanup")
      )
    ).rejects.toThrow(/unresolved outcome/u);
    expect(second.daemon.missions.get(second.missionId).status).toBe("paused");
  });

  it("never appends a mission event after removal", async () => {
    const ctx = await pausedMission(await bootDaemon(opened));
    const seen: DaemonEvent[] = [];
    ctx.daemon.log.subscribe((event) => seen.push(event));
    await ctx.daemon.missions.remove(
      ctx.missionId,
      control(ctx.daemon, ctx.missionId, "delete-quiet")
    );
    ctx.orchestrator.emit({
      input: { todos: "1. [pending] Late" },
      name: "TodoWrite",
      toolUseId: "late-todo",
      type: "tool_call",
    });
    const missing = "not_found: Mission not found";
    expect([
      await outcome(() =>
        ctx.daemon.log.publish(ctx.missionId, notice("late"))
      ),
      await outcome(() =>
        ctx.daemon.missions.patch(ctx.missionId, (mission) => mission)
      ),
      await outcome(() =>
        ctx.daemon.missions.submitMessage(ctx.missionId, {
          mode: "steer",
          operationId: "message-after-delete",
          text: "hello",
        })
      ),
      await outcome(() =>
        ctx.daemon.missions.pause(ctx.missionId, {
          expectedRevision: 0,
          operationId: "pause-after-delete",
        })
      ),
    ]).toStrictEqual([missing, missing, missing, missing]);
    await waitFor(
      () => seen.length,
      (count) => count > 0
    );
    expect({
      bounds: ctx.daemon.log.bounds(ctx.missionId),
      events: seen.map((event) => [event.type, event.missionId]),
      receipts: [
        ctx.daemon.store.getOperation("pause-after-delete"),
        ctx.daemon.store.getOperation("message-after-delete"),
      ],
    }).toStrictEqual({
      bounds: { latest: 0, oldest: 0 },
      events: [["mission.removed", null]],
      receipts: [null, null],
    });
  });
});
