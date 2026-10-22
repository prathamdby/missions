import { writeFile } from "node:fs/promises";
import path from "node:path";

import type { AgentModelSettings } from "@missions/protocol/missions";
import { MissionSnapshotSchema } from "@missions/protocol/missions";
import { routes } from "@missions/protocol/routes";
import { afterEach, describe, expect, it } from "vitest";

import type { DaemonConfig } from "../config";
import { createDaemon } from "../daemon";
import type { Daemon } from "../daemon";
import { pollUntil } from "../lib/async";
import type { PermissionToolUse } from "../sdk/agent-runtime";
import { FakeRuntime } from "../test/fake-runtime";
import { gitRepo, testConfig } from "../test/fixtures";

const opened: Daemon[] = [];
const MODEL: AgentModelSettings = {
  modelId: "fake-model",
  reasoningEffort: null,
};

const createEdit = (filePath: string): PermissionToolUse => ({
  confirmationType: "create",
  details: { content: "hi", fileName: "a.txt", filePath, type: "create" },
  input: {},
  toolName: "Create",
  toolUseId: "edit-1",
});

const boot = async (config?: DaemonConfig) => {
  const runtimes: FakeRuntime[] = [];
  const daemon = await createDaemon({
    config: config ?? (await testConfig()),
    createRuntime: (options) => {
      const runtime = new FakeRuntime(options);
      runtimes.push(runtime);
      return runtime;
    },
    version: "test",
  });
  opened.push(daemon);
  return { daemon, runtimes };
};

const waitFor = async <T>(read: () => T, done: (value: T) => boolean) =>
  await pollUntil(() => Promise.resolve(read()), done, Date.now() + 3000, 10);

const startMission = async (config?: DaemonConfig) => {
  const booted = await boot(config);
  const repo = await gitRepo();
  const added = await booted.daemon.projects.addLocal({
    operationId: "add-project-1",
    path: repo,
  });
  if (added.status !== "added") {
    throw new Error("project not added");
  }
  const snapshot = await booted.daemon.missions.create({
    autonomy: "high",
    goal: "Add a greeting file",
    operationId: "create-mission-1",
    orchestrator: MODEL,
    projectId: added.project.id,
    worker: MODEL,
    workspace: { mode: "current_checkout" },
  });
  const orchestrator = await waitFor(
    () => booted.runtimes[0],
    (r) => (r?.submitted.length ?? 0) > 0
  );
  if (!orchestrator) {
    throw new Error("orchestrator not started");
  }
  return { ...booted, missionId: snapshot.mission.id, orchestrator, repo };
};

const approvePlan = async (ctx: Awaited<ReturnType<typeof startMission>>) => {
  await ctx.orchestrator.tool("propose_plan", {
    markdown: "1. Write the file",
    title: "Greeting",
  });
  return ctx.daemon.missions.decidePlan(ctx.missionId, {
    approve: true,
    planRevision: 1,
  });
};

describe("mission service", () => {
  afterEach(async () => {
    await Promise.all(opened.splice(0).map((daemon) => daemon.close()));
  });

  it("submits the goal natively as steer and mirrors consumption", async () => {
    const { daemon, missionId, orchestrator } = await startMission();
    expect(orchestrator.submitted[0]).toMatchObject({
      id: `${missionId}:goal`,
      mode: "steer",
    });
    orchestrator.consume(`${missionId}:goal`);
    const res = await daemon.app.request(routes.missionSnapshot(missionId), {
      headers: {
        authorization: `Bearer ${daemon.token}`,
        host: "127.0.0.1:4317",
      },
    });
    const snapshot = MissionSnapshotSchema.parse(await res.json());
    expect(snapshot.queue.map((item) => item.state)).toStrictEqual(["sent"]);
    expect(snapshot.transcript.map((item) => item.kind)).toStrictEqual([
      "user",
    ]);
    expect(snapshot.agents.map((agent) => agent.role)).toStrictEqual([
      "orchestrator",
    ]);
  });

  it("blocks writes until the exact plan revision is approved", async () => {
    const ctx = await startMission();
    const { daemon, missionId, orchestrator, repo } = ctx;
    const before = await orchestrator.options.onPermission({
      agentId: orchestrator.options.agentId,
      toolUses: [createEdit(`${repo}/a.txt`)],
    });
    await orchestrator.tool("propose_plan", {
      markdown: "1. Write",
      title: "Greeting",
    });
    expect(daemon.missions.get(missionId).status).toBe("awaiting_approval");
    expect(() =>
      daemon.missions.decidePlan(missionId, { approve: true, planRevision: 2 })
    ).toThrow(/not found/iu);
    daemon.missions.decidePlan(missionId, { approve: true, planRevision: 1 });
    const after = await orchestrator.options.onPermission({
      agentId: orchestrator.options.agentId,
      toolUses: [createEdit(`${repo}/a.txt`)],
    });
    expect([
      before,
      after,
      daemon.missions.get(missionId).status,
    ]).toStrictEqual([false, true, "running"]);
    expect(
      daemon.store.getAgent(orchestrator.options.agentId)?.holdsWriteLease
    ).toBeTruthy();
  });

  it("runs a Worker in the shared workspace and returns its handoff", async () => {
    const ctx = await startMission();
    await expect(
      ctx.orchestrator.tool("dispatch_worker", {
        instructions: "x",
        needsWrite: true,
        title: "Early",
      })
    ).rejects.toThrow(/approves a plan/u);
    await approvePlan(ctx);
    await ctx.orchestrator.tool("dispatch_worker", {
      instructions: "Write a.txt",
      needsWrite: true,
      title: "Write file",
    });
    const worker = await waitFor(
      () => ctx.runtimes[1],
      (r) => (r?.submitted.length ?? 0) > 0
    );
    expect(worker?.options.cwd).toBe(ctx.orchestrator.options.cwd);
    await worker?.tool("submit_handoff", {
      checks: [],
      filesChanged: ["a.txt"],
      followUps: [],
      summary: "Done",
    });
    await waitFor(() => worker?.closed, Boolean);
    const [assignment] = ctx.daemon.missions.snapshot(
      ctx.missionId
    ).assignments;
    expect(assignment?.status).toBe("handed_off");
    expect(
      ctx.orchestrator.submitted.some((s) =>
        s.text.includes("finished assignment")
      )
    ).toBeTruthy();
  });

  it("keeps questions and todos durable and rejects stale answers", async () => {
    const { daemon, missionId, orchestrator } = await startMission();
    await orchestrator.tool("update_todos", {
      todos: [{ content: "Explore", priority: "high", status: "in_progress" }],
    });
    const answer = orchestrator.options.onAskUser({
      agentId: orchestrator.options.agentId,
      questions: [
        {
          index: 1,
          multiSelect: false,
          options: ["A", "B"],
          question: "Which?",
          topic: "Pick",
        },
      ],
      toolCallId: "ask-1",
    });
    const snapshot = daemon.missions.snapshot(missionId);
    expect(snapshot.todos.map((todo) => todo.content)).toStrictEqual([
      "Explore",
    ]);
    const [question] = snapshot.questions;
    expect(() =>
      daemon.missions.answerQuestion(missionId, question?.id ?? "", {
        answers: [],
        epoch: 5,
      })
    ).toThrow(/no longer/u);
    daemon.missions.answerQuestion(missionId, question?.id ?? "", {
      answers: [{ answer: "B", index: 1 }],
      epoch: 0,
    });
    await expect(answer).resolves.toMatchObject({
      answers: [{ answer: "B", question: "Which?" }],
      cancelled: false,
    });
  });

  it("pause fences approvals, deletes native queued messages, and resume never replays", async () => {
    const ctx = await startMission();
    const { daemon, missionId, orchestrator } = ctx;
    orchestrator.consume(`${missionId}:goal`);
    await daemon.missions.submitMessage(missionId, {
      mode: "queue",
      operationId: "queued-msg-1",
      text: "later",
    });
    const pendingAnswer = orchestrator.options.onAskUser({
      agentId: orchestrator.options.agentId,
      questions: [
        {
          index: 1,
          multiSelect: false,
          options: [],
          question: "?",
          topic: "t",
        },
      ],
      toolCallId: "a",
    });
    const paused = await daemon.missions.pause(missionId, {
      expectedRevision: daemon.missions.get(missionId).revision,
      operationId: "pause-op-1",
    });
    await expect(pendingAnswer).resolves.toMatchObject({ cancelled: true });
    expect([
      paused.status,
      paused.epoch,
      orchestrator.closed,
      orchestrator.interrupts,
    ]).toStrictEqual(["paused", 1, true, 1]);
    expect(daemon.store.queue.get("queued-msg-1")?.state).toBe("removed");
    await expect(
      daemon.missions.submitMessage(missionId, {
        mode: "steer",
        operationId: "blocked-msg-1",
        text: "x",
      })
    ).rejects.toThrow(/Resume/u);
    await daemon.missions.resume(missionId, {
      expectedRevision: paused.revision,
      operationId: "resume-op-1",
    });
    const restarted = await waitFor(
      () => ctx.runtimes[1],
      (r) => (r?.submitted.length ?? 0) > 0
    );
    expect(
      restarted?.submitted.map((s) => s.id.startsWith("sys:"))
    ).toStrictEqual([true]);
  });

  it("serves registered artifacts and refuses paths outside the mission folder", async () => {
    const { daemon, missionId, orchestrator, repo } = await startMission();
    await writeFile(
      path.join(repo, "shot.png"),
      Buffer.from([0x89, 0x50, 0x4e, 0x47])
    );
    await orchestrator.tool("attach_artifact", {
      path: path.join(repo, "shot.png"),
    });
    const [artifact] = daemon.missions.snapshot(missionId).artifacts;
    const headers = {
      authorization: `Bearer ${daemon.token}`,
      host: "127.0.0.1:4317",
    };
    const res = await daemon.app.request(
      routes.artifact(missionId, artifact?.id ?? ""),
      { headers }
    );
    expect([
      res.status,
      res.headers.get("content-type"),
      res.headers.get("x-content-type-options"),
    ]).toStrictEqual([200, "image/png", "nosniff"]);
    const escaped = await daemon.app.request(
      `${routes.file(missionId)}?path=../../etc/passwd`,
      { headers }
    );
    expect(escaped.status).toBe(403);
    await expect(
      orchestrator.tool("attach_artifact", { path: "/etc/hostname" })
    ).rejects.toThrow(/escapes/u);
  });

  it("marks active missions interrupted after a crash without restarting agents", async () => {
    const config = await testConfig();
    const ctx = await startMission(config);
    await ctx.daemon.missions.submitMessage(ctx.missionId, {
      mode: "queue",
      operationId: "queued-msg-2",
      text: "later",
    });
    const second = await boot(config);
    const snapshot = second.daemon.missions.snapshot(ctx.missionId);
    expect(snapshot.mission.status).toBe("interrupted");
    expect(
      snapshot.queue.find((item) => item.id === "queued-msg-2")?.state
    ).toBe("unknown");
    expect(second.runtimes).toHaveLength(0);
  });
});
