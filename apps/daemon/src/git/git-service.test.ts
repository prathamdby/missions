import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { chmod, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { ChangesSchema } from "@missions/protocol/files";
import { routes } from "@missions/protocol/routes";
import { afterEach, describe, expect, it } from "vitest";

import { createDaemon } from "../daemon";
import type { Daemon } from "../daemon";
import type { RuntimeHandle } from "../missions/mission-service";
import { NativeQueueTracker } from "../sdk/native-queue";
import { gitRepo, sh, tempDir, testConfig } from "../test/fixtures";

const opened: Daemon[] = [];

const idleRuntime = (): RuntimeHandle => ({
  changeMode: () => Promise.resolve(),
  close: () => Promise.resolve({ stopped: true, survivors: [] }),
  edit: () => Promise.resolve("replaced"),
  interrupt: () => Promise.resolve(),
  queue: new NativeQueueTracker(() => null),
  remove: () => Promise.resolve("removed"),
  sessionId: "s",
  start: () =>
    Promise.resolve({
      cwd: null,
      messages: [],
      pendingIds: [],
      queuedIds: [],
      sessionId: "s",
      workingState: "idle",
    }),
  submit: () => Promise.resolve(),
});

const FAKE_GH = (dir: string) => `#!/usr/bin/env node
const fs = require("fs");
const D = ${JSON.stringify(dir)};
const args = process.argv.slice(2);
fs.appendFileSync(D + "/calls.log", JSON.stringify(args) + "\\n");
const state = () => JSON.parse(fs.readFileSync(D + "/prs.json", "utf8"));
if (args[0] === "pr" && args[1] === "list") {
  console.log(JSON.stringify(state()));
} else if (args[0] === "pr" && args[1] === "create") {
  const prs = state();
  const pr = { number: 7, url: "https://github.com/o/r/pull/7", state: "OPEN", isDraft: true, updatedAt: new Date().toISOString(), headRefOid: "x", statusCheckRollup: [] };
  prs.push(pr);
  fs.writeFileSync(D + "/prs.json", JSON.stringify(prs));
  console.log(pr.url);
} else if (args[0] === "pr" && args[1] === "view") {
  console.log(JSON.stringify(state()[0]));
} else {
  process.exit(1);
}
`;

const setup = async (
  mode: "new_worktree" | "current_checkout" = "new_worktree"
) => {
  const repoDir = await gitRepo();
  const bare = path.join(await tempDir("remote"), "origin.git");
  execFileSync("git", ["clone", "-q", "--bare", repoDir, bare]);
  sh(repoDir, ["remote", "add", "origin", bare]);
  sh(repoDir, ["fetch", "-q", "origin"]);
  const ghDir = await tempDir("gh");
  await writeFile(path.join(ghDir, "prs.json"), "[]");
  await writeFile(path.join(ghDir, "gh"), FAKE_GH(ghDir));
  await chmod(path.join(ghDir, "gh"), 0o755);
  const daemon = await createDaemon({
    config: await testConfig(),
    createRuntime: idleRuntime,
    ghPath: path.join(ghDir, "gh"),
    version: "test",
  });
  opened.push(daemon);
  const added = await daemon.projects.addLocal({
    operationId: "add-project-1",
    path: repoDir,
  });
  if (added.status !== "added") {
    throw new Error("not added");
  }
  const snapshot = await daemon.missions.create({
    goal: "Publish a change",
    operationId: "create-mission-1",
    projectId: added.project.id,
    workspace:
      mode === "new_worktree" ? { baseBranch: "main", mode } : { mode },
  });
  const missionId = snapshot.mission.id;
  const workspace = snapshot.mission.workspace?.path ?? "";
  await daemon.missions.pause(missionId, {
    expectedRevision: daemon.missions.get(missionId).revision,
    operationId: "pause-mission-1",
  });
  const headers = {
    authorization: `Bearer ${daemon.token}`,
    host: "127.0.0.1:4317",
  };
  const review = async () => {
    const res = await daemon.app.request(routes.changes(missionId), {
      headers,
    });
    return ChangesSchema.parse(await res.json());
  };
  const calls = async () => {
    const log = await readFile(path.join(ghDir, "calls.log"), "utf-8").catch(
      () => ""
    );
    return log.split("\n").filter(Boolean);
  };
  return { bare, calls, daemon, ghDir, missionId, repoDir, review, workspace };
};

const commitAll = async (
  ctx: Awaited<ReturnType<typeof setup>>,
  operationId: string
) => {
  const changes = await ctx.review();
  return await ctx.daemon.publish.commit(ctx.missionId, {
    expectedChangesHash: changes.hash,
    expectedHead: changes.head,
    message: "Add greeting",
    operationId,
  });
};

const simulateUnknown = (
  daemon: Daemon,
  id: string,
  kind: string,
  missionId: string
) => {
  const at = new Date().toISOString();
  daemon.store.putOperation(
    {
      createdAt: at,
      detail: {},
      id,
      kind,
      missionId,
      status: "intent",
      updatedAt: at,
    },
    null
  );
  daemon.journal.recoverInterrupted();
};

describe("publish lifecycle", () => {
  afterEach(async () => {
    await Promise.all(opened.splice(0).map((daemon) => daemon.close()));
  });

  it("rejects stale reviews and commits once per operation", async () => {
    const ctx = await setup();
    await writeFile(path.join(ctx.workspace, "hello.txt"), "hi\n");
    const reviewed = await ctx.review();
    await writeFile(path.join(ctx.workspace, "hello.txt"), "hi again\n");
    await expect(
      ctx.daemon.publish.commit(ctx.missionId, {
        expectedChangesHash: reviewed.hash,
        expectedHead: reviewed.head,
        message: "x",
        operationId: "commit-stale-1",
      })
    ).rejects.toMatchObject({ code: "stale_revision" });
    const first = await commitAll(ctx, "commit-op-1");
    const again = await ctx.daemon.publish.commit(ctx.missionId, {
      expectedChangesHash: "ignored",
      expectedHead: null,
      message: "Add greeting",
      operationId: "commit-op-1",
    });
    expect([
      first.publish.commits.length,
      again.publish.commits.length,
    ]).toStrictEqual([1, 1]);
    expect(sh(ctx.workspace, ["rev-list", "--count", "HEAD"])).toBe("2");
  });

  it("reconciles an unknown push against the remote instead of pushing again", async () => {
    const ctx = await setup();
    await writeFile(path.join(ctx.workspace, "hello.txt"), "hi\n");
    await commitAll(ctx, "commit-op-2");
    const head = sh(ctx.workspace, ["rev-parse", "HEAD"]);
    const branch = sh(ctx.workspace, ["branch", "--show-current"]);
    sh(ctx.workspace, ["push", "-q", "origin", `HEAD:refs/heads/${branch}`]);
    simulateUnknown(ctx.daemon, "push-op-1", "git.push", ctx.missionId);
    const mission = await ctx.daemon.publish.push(ctx.missionId, {
      expectedHead: head,
      operationId: "push-op-1",
    });
    expect(mission.publish.pushedBranch).toBe(branch);
    expect(ctx.daemon.journal.get("push-op-1")?.operation.status).toBe(
      "reconciled"
    );
    await expect(
      ctx.daemon.publish.push(ctx.missionId, {
        expectedHead: "0".repeat(40),
        operationId: "push-op-2",
      })
    ).rejects.toMatchObject({ code: "stale_revision" });
  });

  it("adopts a PR created before a crash and never opens a duplicate", async () => {
    const ctx = await setup();
    await writeFile(path.join(ctx.workspace, "hello.txt"), "hi\n");
    await commitAll(ctx, "commit-op-3");
    const head = sh(ctx.workspace, ["rev-parse", "HEAD"]);
    await ctx.daemon.publish.push(ctx.missionId, {
      expectedHead: head,
      operationId: "push-op-3",
    });
    await writeFile(
      path.join(ctx.ghDir, "prs.json"),
      JSON.stringify([
        {
          headRefOid: head,
          isDraft: true,
          number: 9,
          state: "OPEN",
          statusCheckRollup: [],
          updatedAt: new Date().toISOString(),
          url: "https://github.com/o/r/pull/9",
        },
      ])
    );
    simulateUnknown(ctx.daemon, "pr-op-1", "github.pr", ctx.missionId);
    const adopted = await ctx.daemon.publish.createPullRequest(ctx.missionId, {
      body: "b",
      expectedHead: head,
      operationId: "pr-op-1",
      title: "t",
    });
    const fresh = await ctx.daemon.publish.createPullRequest(ctx.missionId, {
      body: "b",
      expectedHead: head,
      operationId: "pr-op-2",
      title: "t",
    });
    expect([
      adopted.publish.pr?.number,
      fresh.publish.pr?.number,
    ]).toStrictEqual([9, 9]);
    const calls = await ctx.calls();
    expect(calls.some((call) => call.includes('"create"'))).toBeFalsy();
  });

  it("keeps dirty or unowned folders and removes a clean merged worktree", async () => {
    const unowned = await setup("current_checkout");
    const kept = await unowned.daemon.publish.cleanup(unowned.missionId, {
      action: "remove",
      operationId: "cleanup-op-1",
    });
    expect([kept.publish.cleanup, existsSync(unowned.workspace)]).toStrictEqual(
      ["blocked", true]
    );
    const ctx = await setup();
    await writeFile(path.join(ctx.workspace, "scratch.txt"), "dirty\n");
    const dirty = await ctx.daemon.publish.cleanup(ctx.missionId, {
      action: "remove",
      operationId: "cleanup-op-2",
    });
    expect([
      dirty.publish.cleanup,
      dirty.publish.cleanupReason,
      existsSync(ctx.workspace),
    ]).toStrictEqual([
      "blocked",
      "The worktree has uncommitted changes, so it is kept",
      true,
    ]);
    await commitAll(ctx, "commit-op-4");
    const removed = await ctx.daemon.publish.cleanup(ctx.missionId, {
      action: "remove",
      operationId: "cleanup-op-3",
    });
    expect([
      removed.publish.cleanup,
      removed.status,
      existsSync(ctx.workspace),
    ]).toStrictEqual(["removed", "archived", false]);
  });
});
