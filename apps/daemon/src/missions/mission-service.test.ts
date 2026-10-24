import { rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { setImmediate as yieldImmediate } from "node:timers/promises";

import type {
  AgentModelSettings,
  Operation,
} from "@missions/protocol/missions";
import { MissionSnapshotSchema } from "@missions/protocol/missions";
import { routes } from "@missions/protocol/routes";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { DaemonConfig } from "../config";
import { createDaemon } from "../daemon";
import type { Daemon } from "../daemon";
import { pollUntil } from "../lib/async";
import { ProcessRecordRepository } from "../processes/process-record-repository";
import type { PermissionToolUse } from "../sdk/agent-runtime";
import type { ModelLoader } from "../settings/models";
import { FakeRuntime } from "../test/fake-runtime";
import { gitRepo, testConfig } from "../test/fixtures";

const opened: Daemon[] = [];
const MODEL: AgentModelSettings = {
  modelId: "fake-model",
  reasoningEffort: null,
};
const NEXT_MODEL: AgentModelSettings = {
  modelId: "next-model",
  reasoningEffort: "high",
};
const NO_EFFORT_MODEL: AgentModelSettings = {
  modelId: "plain-model",
  reasoningEffort: null,
};
const RAW_MODELS = [
  ...["fake-model", "next-model"].map((id) => ({
    defaultReasoningEffort: "medium",
    id,
    supportedReasoningEfforts: ["low", "medium", "high"],
  })),
  {
    defaultReasoningEffort: null,
    id: "plain-model",
    supportedReasoningEfforts: [],
  },
];

const emitTodoStatus = (runtime: FakeRuntime, id: string, status: string) => {
  runtime.emit({
    input: { todos: `1. [${status}] Explore` },
    name: "TodoWrite",
    toolUseId: id,
    type: "tool_call",
  });
  runtime.emit({
    content: "Saved",
    isError: false,
    toolUseId: id,
    type: "tool_result",
  });
};

const createEdit = (filePath: string): PermissionToolUse => ({
  confirmationType: "create",
  details: { content: "hi", fileName: "a.txt", filePath, type: "create" },
  input: {},
  toolName: "Create",
  toolUseId: "edit-1",
});

const boot = async (
  config?: DaemonConfig,
  configure?: (runtime: FakeRuntime, index: number) => void,
  loadModels: ModelLoader = () => Promise.resolve(RAW_MODELS)
) => {
  const runtimes: FakeRuntime[] = [];
  const daemon = await createDaemon({
    config: config ?? (await testConfig()),
    createRuntime: (options) => {
      const runtime = new FakeRuntime(options);
      configure?.(runtime, runtimes.length);
      runtimes.push(runtime);
      return runtime;
    },
    loadModels,
    version: "test",
  });
  opened.push(daemon);
  return { daemon, runtimes };
};

const waitFor = async <T>(read: () => T, done: (value: T) => boolean) =>
  await pollUntil(() => Promise.resolve(read()), done, Date.now() + 3000, 10);

interface MissionOptions {
  goal?: string;
}

const createMission = async (
  booted: Awaited<ReturnType<typeof boot>>,
  suffix = "1",
  workspacePath?: string,
  options: MissionOptions = {}
) => {
  const repo = workspacePath ?? (await gitRepo());
  const added = await booted.daemon.projects.addLocal({
    operationId: `add-project-${suffix}`,
    path: repo,
  });
  if (added.status !== "added") {
    throw new Error("project not added");
  }
  const snapshot = await booted.daemon.missions.create({
    goal: options.goal ?? "Add a greeting file",
    operationId: `create-mission-${suffix}`,
    orchestrator: MODEL,
    projectId: added.project.id,
    worker: MODEL,
    workspace: { mode: "current_checkout" },
  });
  return { ...booted, missionId: snapshot.mission.id, repo };
};

const startMission = async (
  config?: DaemonConfig,
  options: MissionOptions = {}
) => {
  const created = await createMission(
    await boot(config),
    "1",
    undefined,
    options
  );
  const orchestrator = await waitFor(
    () => created.runtimes[0],
    (r) => (r?.submitted.length ?? 0) > 0
  );
  if (!orchestrator) {
    throw new Error("orchestrator not started");
  }
  if (options.goal?.endsWith("Plan it first.")) {
    orchestrator.consume(`${created.missionId}:goal`);
    await orchestrator.tool("enter_plan", {});
    orchestrator.emit({
      reason: "end_turn",
      turnId: null,
      type: "turn_completed",
    });
    await waitFor(
      () =>
        orchestrator.submitted.some((item) =>
          item.text.includes("Plan mode is now active")
        ),
      Boolean
    );
  }
  return { ...created, orchestrator };
};

/** An unrecognized Droid permission the policy does not approve, so the user must decide. */
const UNCLASSIFIED: PermissionToolUse = {
  confirmationType: "custom",
  details: { type: "custom" },
  input: {},
  toolName: "Mystery",
  toolUseId: "mystery",
};

const proposePlan = (
  runtime: FakeRuntime,
  plan = "1. Write",
  title = "Greeting",
  toolUseId = "spec-1"
) =>
  runtime.options.onPermission({
    agentId: runtime.options.agentId,
    toolUses: [
      {
        confirmationType: "exit_spec_mode",
        details: { plan, title, type: "exit_spec_mode" },
        input: {},
        toolName: "ExitSpecMode",
        toolUseId,
      },
    ],
  });

/** Waits until the outbox handed a message to the runner's native queue. */
const nativelyQueued = async (daemon: Daemon, id: string) => {
  const item = await waitFor(
    () => daemon.store.queue.get(id),
    (entry) => entry?.state === "queued"
  );
  if (item?.state !== "queued") {
    throw new Error(`${id} was not delivered`);
  }
  return item;
};

const saveCleanupOperation = (
  ctx: { daemon: Daemon; missionId: string },
  id: string,
  changes: Partial<Operation> = {}
) => {
  const at = ctx.daemon.missions.get(ctx.missionId).updatedAt;
  ctx.daemon.store.putOperation({
    createdAt: at,
    detail: { action: "remove" },
    id,
    kind: "workspace.cleanup",
    missionId: ctx.missionId,
    status: "unknown",
    updatedAt: at,
    ...changes,
  });
};

describe("mission service", () => {
  afterEach(async () => {
    await Promise.all(opened.splice(0).map((daemon) => daemon.close()));
  });

  it("persists successful native TodoWrite calls and ignores failed, malformed, or fenced results", async () => {
    const ctx = await startMission();
    const emitTodos = (id: string, todos: unknown, isError = false) => {
      ctx.orchestrator.emit({
        input: { todos },
        name: "TodoWrite",
        toolUseId: id,
        type: "tool_call",
      });
      ctx.orchestrator.emit({
        content: "Todos saved",
        isError,
        toolUseId: id,
        type: "tool_result",
      });
    };
    emitTodos("native-todos", "1. [completed] Explore\n2. [in_progress] Build");
    const saved = ctx.daemon.missions.snapshot(ctx.missionId).todos;
    expect(
      saved.map(({ content, status }) => ({ content, status }))
    ).toStrictEqual([
      { content: "Explore", status: "completed" },
      { content: "Build", status: "in_progress" },
    ]);
    expect(
      saved.every((todo) => todo.agentId === ctx.orchestrator.options.agentId)
    ).toBeTruthy();
    expect(
      ctx.daemon.log
        .replay(ctx.missionId, 0)
        .some((event) => event.type === "todos.updated")
    ).toBeTruthy();
    emitTodos("failed", [], true);
    emitTodos("malformed", "broken");
    expect(ctx.daemon.missions.snapshot(ctx.missionId).todos).toStrictEqual(
      saved
    );
    await ctx.daemon.missions.pause(ctx.missionId, {
      expectedRevision: ctx.daemon.missions.get(ctx.missionId).revision,
      operationId: "native-todos-pause",
    });
    emitTodos("late", []);
    expect(ctx.daemon.missions.snapshot(ctx.missionId).todos).toStrictEqual(
      saved
    );
  });

  it("does not let replayed native calls overwrite newer todos, including after resume", async () => {
    const ctx = await startMission();
    emitTodoStatus(ctx.orchestrator, "earlier", "pending");
    emitTodoStatus(ctx.orchestrator, "latest", "completed");
    const saved = ctx.daemon.missions.snapshot(ctx.missionId).todos;
    emitTodoStatus(ctx.orchestrator, "earlier", "pending");
    expect(ctx.daemon.missions.snapshot(ctx.missionId).todos).toStrictEqual(
      saved
    );
    const paused = await ctx.daemon.missions.pause(ctx.missionId, {
      expectedRevision: ctx.daemon.missions.get(ctx.missionId).revision,
      operationId: "replay-pause",
    });
    await ctx.daemon.missions.resume(ctx.missionId, {
      expectedRevision: paused.revision,
      operationId: "replay-resume",
    });
    const restored = ctx.runtimes.at(-1);
    if (!restored || restored === ctx.orchestrator) {
      throw new Error("Orchestrator session was not restored");
    }
    restored.emit({
      message: {
        id: "replayed-use",
        requestId: null,
        role: "assistant",
        sender: null,
        text: "",
        thinking: "",
        toolResults: [],
        toolUses: [
          {
            id: "earlier",
            input: { todos: "1. [pending] Explore" },
            name: "TodoWrite",
          },
        ],
      },
      type: "message",
    });
    restored.emit({
      message: {
        id: "replayed-result",
        requestId: null,
        role: "user",
        sender: null,
        text: "",
        thinking: "",
        toolResults: [
          { content: "Saved", isError: false, toolUseId: "earlier" },
        ],
        toolUses: [],
      },
      type: "message",
    });
    expect(ctx.daemon.missions.snapshot(ctx.missionId).todos).toStrictEqual(
      saved
    );
    const updates = ctx.daemon.log
      .replay(ctx.missionId, 0)
      .filter((event) => event.type === "todos.updated");
    expect(updates).toHaveLength(2);
  });

  it("imports native todos from complete SDK messages, including worker checklists", async () => {
    const ctx = await startMission();
    await ctx.orchestrator.tool("dispatch_worker", {
      instructions: "Read",
      needsWrite: false,
      title: "Read",
    });
    const worker = await waitFor(
      () => ctx.runtimes[1],
      (runtime) => Boolean(runtime?.submitted.length)
    );
    if (!worker) {
      throw new Error("Worker did not start");
    }
    worker.emit({
      message: {
        id: "native-use",
        requestId: null,
        role: "assistant",
        sender: null,
        text: "",
        thinking: "",
        toolResults: [],
        toolUses: [
          {
            id: "native-use-id",
            input: { todos: [{ content: "Worker task", status: "pending" }] },
            name: "TodoWrite",
          },
        ],
      },
      type: "message",
    });
    worker.emit({
      message: {
        id: "native-result",
        requestId: null,
        role: "user",
        sender: null,
        text: "",
        thinking: "",
        toolResults: [
          { content: "Saved", isError: false, toolUseId: "native-use-id" },
        ],
        toolUses: [],
      },
      type: "message",
    });
    expect(ctx.daemon.missions.snapshot(ctx.missionId).todos).toStrictEqual([
      expect.objectContaining({
        agentId: worker.options.agentId,
        content: "Worker task",
      }),
    ]);
  });

  it("resumes original worker sessions across repeated pauses without creating replacement agents", async () => {
    const ctx = await startMission();
    await ctx.orchestrator.tool("dispatch_worker", {
      instructions: "Read",
      needsWrite: false,
      title: "Read",
    });
    const worker = await waitFor(
      () => ctx.runtimes[1],
      (runtime) => Boolean(runtime?.submitted.length)
    );
    const before = ctx.daemon.missions.snapshot(ctx.missionId);
    const pauseAndResume = async (operation: string) => {
      const paused = await ctx.daemon.missions.pause(ctx.missionId, {
        expectedRevision: ctx.daemon.missions.get(ctx.missionId).revision,
        operationId: `pause-${operation}`,
      });
      await ctx.daemon.missions.resume(ctx.missionId, {
        expectedRevision: paused.revision,
        operationId: `resume-${operation}`,
      });
    };
    await pauseAndResume("first");
    const resumed = ctx.runtimes.at(-1);
    expect({
      agentId: resumed?.options.agentId,
      sessionId: resumed?.sessionId,
    }).toStrictEqual({
      agentId: worker?.options.agentId,
      sessionId: worker?.sessionId,
    });
    expect(resumed?.submitted[0]?.text).toContain("saved context");
    await pauseAndResume("second");
    const after = ctx.daemon.missions.snapshot(ctx.missionId);
    expect(after.agents.map((agent) => agent.id).toSorted()).toStrictEqual(
      before.agents.map((agent) => agent.id).toSorted()
    );
    expect(after.assignments).toStrictEqual([
      expect.objectContaining({
        id: before.assignments[0]?.id,
        status: "running",
        workerAgentId: worker?.options.agentId,
      }),
    ]);
    expect(ctx.runtimes.at(-1)?.sessionId).toBe(worker?.sessionId);
  });

  it("surfaces saved-worker load failures instead of silently replacing the worker", async () => {
    const booted = await boot(undefined, (runtime, index) => {
      if (index === 3) {
        vi.spyOn(runtime, "start").mockRejectedValue(
          new Error("Saved session missing")
        );
      }
    });
    const ctx = await createMission(booted, "resume-failure");
    const orchestrator = await waitFor(
      () => ctx.runtimes[0],
      (runtime) => Boolean(runtime?.submitted.length)
    );
    if (!orchestrator) {
      throw new Error("Orchestrator did not start");
    }
    await orchestrator.tool("dispatch_worker", {
      instructions: "Read",
      needsWrite: false,
      title: "Read",
    });
    await waitFor(
      () => ctx.runtimes[1],
      (runtime) => Boolean(runtime?.submitted.length)
    );
    const paused = await ctx.daemon.missions.pause(ctx.missionId, {
      expectedRevision: ctx.daemon.missions.get(ctx.missionId).revision,
      operationId: "failed-worker-pause",
    });
    await ctx.daemon.missions.resume(ctx.missionId, {
      expectedRevision: paused.revision,
      operationId: "failed-worker-resume",
    });
    const after = ctx.daemon.missions.snapshot(ctx.missionId);
    expect(after.agents).toHaveLength(2);
    expect(after.assignments[0]?.status).toBe("failed");
    const notified = await waitFor(
      () =>
        ctx.runtimes[2]?.submitted.some((item) =>
          item.text.includes("Saved session missing")
        ),
      Boolean
    );
    expect(notified).toBeTruthy();
  });

  it("updates the active native session and future worker preference, not defaults or existing workers", async () => {
    const ctx = await startMission();
    await ctx.orchestrator.tool("dispatch_worker", {
      instructions: "Read only",
      needsWrite: false,
      title: "Existing worker",
    });
    const existing = await waitFor(
      () => ctx.runtimes[1],
      (runtime) => Boolean(runtime?.submitted.length)
    );
    const defaults = ctx.daemon.settings.get();
    const mission = ctx.daemon.missions.get(ctx.missionId);
    const updated = await ctx.daemon.missions.update(ctx.missionId, {
      expectedRevision: mission.revision,
      orchestrator: NEXT_MODEL,
      worker: NEXT_MODEL,
    });
    expect(updated).toMatchObject({
      orchestrator: NEXT_MODEL,
      worker: NEXT_MODEL,
    });
    expect({
      closed: ctx.orchestrator.closed,
      goals: ctx.orchestrator.submitted.filter(
        (item) => item.id === `${ctx.missionId}:goal`
      ).length,
      interrupts: ctx.orchestrator.interrupts,
      model: ctx.orchestrator.model,
      updates: ctx.orchestrator.modelUpdates,
    }).toStrictEqual({
      closed: false,
      goals: 1,
      interrupts: 0,
      model: NEXT_MODEL,
      updates: [NEXT_MODEL],
    });
    expect({
      model: existing?.model,
      updates: existing?.modelUpdates,
    }).toStrictEqual({ model: MODEL, updates: [] });
    expect(ctx.daemon.settings.get()).toStrictEqual(defaults);
    await ctx.orchestrator.tool("dispatch_worker", {
      instructions: "Read next",
      needsWrite: false,
      title: "Future worker",
    });
    const next = await waitFor(() => ctx.runtimes[2], Boolean);
    expect(next?.model).toStrictEqual(NEXT_MODEL);
  });

  it("updates reasoning independently and resolves a model's default for native use", async () => {
    const { daemon, missionId, orchestrator } = await startMission();
    let mission = await daemon.missions.update(missionId, {
      expectedRevision: daemon.missions.get(missionId).revision,
      orchestrator: { ...MODEL, reasoningEffort: "low" },
    });
    expect(orchestrator.model.reasoningEffort).toBe("low");
    mission = await daemon.missions.update(missionId, {
      expectedRevision: mission.revision,
      orchestrator: { ...NEXT_MODEL, reasoningEffort: null },
    });
    expect(orchestrator.model).toStrictEqual({
      ...NEXT_MODEL,
      reasoningEffort: "medium",
    });
    expect(mission.orchestrator.reasoningEffort).toBeNull();
  });

  it.each([NEXT_MODEL, NO_EFFORT_MODEL])(
    "accepts a pending startup choice %j promptly and reconciles before the first goal",
    async (choice) => {
      const gate = Promise.withResolvers<undefined>();
      const booted = await boot(undefined, (runtime) => {
        const start = runtime.start.bind(runtime);
        vi.spyOn(runtime, "start").mockImplementation(async () => {
          await gate.promise;
          return await start();
        });
      });
      const { daemon, missionId } = await createMission(booted);
      const runtime = await waitFor(() => booted.runtimes[0], Boolean);
      const updated = await daemon.missions.update(missionId, {
        expectedRevision: daemon.missions.get(missionId).revision,
        orchestrator: choice,
      });
      expect(updated.orchestrator).toStrictEqual(choice);
      expect(runtime?.submitted).toStrictEqual([]);
      expect(runtime?.modelUpdates).toStrictEqual([]);
      gate.resolve(undefined);
      await waitFor(() => runtime?.submitted.length, Boolean);
      expect({
        model: runtime?.model,
        saved: daemon.store.getAgent(runtime?.options.agentId ?? "")?.model,
        submitted: runtime?.submitted.length,
      }).toStrictEqual({ model: choice, saved: choice, submitted: 1 });
    }
  );

  it("switches a ready orchestrator both ways with a no-effort model and rejects explicit effort", async () => {
    const { daemon, missionId, orchestrator } = await startMission();
    const defaults = daemon.settings.get();
    const update = (choice: AgentModelSettings) =>
      daemon.missions.update(missionId, {
        expectedRevision: daemon.missions.get(missionId).revision,
        orchestrator: choice,
      });
    await update(NO_EFFORT_MODEL);
    await update(NEXT_MODEL);
    const plain = await update(NO_EFFORT_MODEL);
    await expect(
      update({ ...NO_EFFORT_MODEL, reasoningEffort: "high" })
    ).rejects.toThrow(/does not support/u);
    expect({
      defaults: daemon.settings.get(),
      model: orchestrator.model,
      preference: plain.orchestrator,
      updates: orchestrator.modelUpdates,
      worker: plain.worker,
    }).toStrictEqual({
      defaults,
      model: NO_EFFORT_MODEL,
      preference: NO_EFFORT_MODEL,
      updates: [NO_EFFORT_MODEL, NEXT_MODEL, NO_EFFORT_MODEL],
      worker: MODEL,
    });
  });

  it.each(["stale", "native"])(
    "restores a no-effort model after %s failure without persisting the rejected switch",
    async (failure) => {
      const { daemon, missionId, orchestrator } = await startMission();
      const before = await daemon.missions.update(missionId, {
        expectedRevision: daemon.missions.get(missionId).revision,
        orchestrator: NO_EFFORT_MODEL,
      });
      const apply = orchestrator.updateModel.bind(orchestrator);
      vi.spyOn(orchestrator, "updateModel").mockImplementationOnce(
        async (choice) => {
          const confirmed = await apply(choice);
          if (failure === "native") {
            throw new Error("Native response lost after switch");
          }
          daemon.missions.patch(missionId, (mission) => ({
            ...mission,
            title: "Concurrent title",
          }));
          return confirmed;
        }
      );
      await expect(
        daemon.missions.update(missionId, {
          expectedRevision: before.revision,
          orchestrator: NEXT_MODEL,
          worker: NEXT_MODEL,
        })
      ).rejects.toThrow(
        failure === "native" ? /Native response lost/u : /mission changed/u
      );
      expect({
        model: orchestrator.model,
        saved: daemon.store.getAgent(orchestrator.options.agentId)?.model,
        updates: orchestrator.modelUpdates,
      }).toStrictEqual({
        model: NO_EFFORT_MODEL,
        saved: NO_EFFORT_MODEL,
        updates: [NO_EFFORT_MODEL, NEXT_MODEL, NO_EFFORT_MODEL],
      });
      expect(daemon.missions.get(missionId)).toMatchObject({
        orchestrator: NO_EFFORT_MODEL,
        worker: MODEL,
      });
    }
  );

  it("rejects invalid choices without partially persisting another preference", async () => {
    const { daemon, missionId, orchestrator } = await startMission();
    const before = daemon.missions.get(missionId);
    await expect(
      daemon.missions.update(missionId, {
        expectedRevision: before.revision,
        orchestrator: NEXT_MODEL,
        worker: { ...NEXT_MODEL, reasoningEffort: "max" },
      })
    ).rejects.toThrow(/does not support/u);
    await expect(
      daemon.missions.update(missionId, {
        expectedRevision: before.revision,
        worker: { ...MODEL, modelId: "missing" },
      })
    ).rejects.toThrow(/not available/u);
    expect(daemon.missions.get(missionId)).toStrictEqual(before);
    expect(orchestrator.modelUpdates).toStrictEqual([]);
  });

  it("reconciles a newer pending preference before releasing startup, even during a native acknowledgement", async () => {
    const startGate = Promise.withResolvers<undefined>();
    const nativeGate = Promise.withResolvers<undefined>();
    const entered = Promise.withResolvers<undefined>();
    const ctx = await createMission(
      await boot(undefined, (runtime) => {
        const start = runtime.start.bind(runtime);
        const apply = runtime.updateModel.bind(runtime);
        vi.spyOn(runtime, "start").mockImplementation(async () => {
          await startGate.promise;
          return await start();
        });
        vi.spyOn(runtime, "updateModel").mockImplementationOnce(
          async (choice) => {
            const result = await apply(choice);
            entered.resolve(undefined);
            await nativeGate.promise;
            return result;
          }
        );
      })
    );
    const runtime = await waitFor(() => ctx.runtimes[0], Boolean);
    const first = await ctx.daemon.missions.update(ctx.missionId, {
      expectedRevision: ctx.daemon.missions.get(ctx.missionId).revision,
      orchestrator: NEXT_MODEL,
    });
    startGate.resolve(undefined);
    await entered.promise;
    const latest = { ...NEXT_MODEL, reasoningEffort: "low" as const };
    await ctx.daemon.missions.update(ctx.missionId, {
      expectedRevision: first.revision,
      orchestrator: latest,
    });
    expect(runtime?.submitted).toStrictEqual([]);
    nativeGate.resolve(undefined);
    await waitFor(() => runtime?.submitted.length, Boolean);
    expect({
      goals: runtime?.submitted.length,
      model: runtime?.model,
      updates: runtime?.modelUpdates,
    }).toStrictEqual({
      goals: 1,
      model: latest,
      updates: [NEXT_MODEL, latest],
    });
  });

  it("checks stale revision again after asynchronous catalog validation", async () => {
    const loading = Promise.withResolvers<unknown[]>();
    const load = vi.fn<ModelLoader>(() => loading.promise);
    const ctx = await createMission(await boot(undefined, undefined, load));
    await waitFor(() => ctx.runtimes[0]?.submitted.length, Boolean);
    const { revision } = ctx.daemon.missions.get(ctx.missionId);
    const updating = ctx.daemon.missions.update(ctx.missionId, {
      expectedRevision: revision,
      orchestrator: NEXT_MODEL,
    });
    await ctx.daemon.missions.update(ctx.missionId, {
      expectedRevision: revision,
      title: "New title",
    });
    loading.resolve(RAW_MODELS);
    await expect(updating).rejects.toMatchObject({ code: "stale_revision" });
    expect(ctx.daemon.missions.get(ctx.missionId).title).toBe("New title");
    expect(ctx.runtimes[0]?.modelUpdates).toStrictEqual([]);
  });

  it("restores the native choice if revision changes during its acknowledgement", async () => {
    const { daemon, missionId, orchestrator } = await startMission();
    const gate = Promise.withResolvers<undefined>();
    const entered = Promise.withResolvers<undefined>();
    const apply = orchestrator.updateModel.bind(orchestrator);
    vi.spyOn(orchestrator, "updateModel").mockImplementationOnce(
      async (choice) => {
        const result = await apply(choice);
        entered.resolve(undefined);
        await gate.promise;
        return result;
      }
    );
    const { revision } = daemon.missions.get(missionId);
    const updating = daemon.missions.update(missionId, {
      expectedRevision: revision,
      orchestrator: NEXT_MODEL,
      worker: NEXT_MODEL,
    });
    await entered.promise;
    await daemon.missions.update(missionId, {
      expectedRevision: revision,
      title: "Keep this title",
    });
    gate.resolve(undefined);
    await expect(updating).rejects.toMatchObject({ code: "stale_revision" });
    expect(orchestrator.model).toStrictEqual(MODEL);
    expect(daemon.missions.get(missionId)).toMatchObject({
      orchestrator: MODEL,
      title: "Keep this title",
      worker: MODEL,
    });
  });

  it("does not save rejected native settings and returns an actionable HTTP error", async () => {
    const { daemon, missionId, orchestrator } = await startMission();
    vi.spyOn(orchestrator, "updateModel").mockRejectedValueOnce(
      new Error("Native rejection")
    );
    const before = daemon.missions.get(missionId);
    const response = await daemon.app.request(routes.mission(missionId), {
      body: JSON.stringify({
        expectedRevision: before.revision,
        orchestrator: NEXT_MODEL,
      }),
      headers: {
        authorization: `Bearer ${daemon.token}`,
        "content-type": "application/json",
        host: "127.0.0.1:4317",
      },
      method: "PATCH",
    });
    expect(response.status).toBe(409);
    expect(JSON.stringify(await response.json())).toContain("Native rejection");
    expect(daemon.missions.get(missionId)).toStrictEqual(before);
    expect(orchestrator.model).toStrictEqual(MODEL);
  });

  it("publishes the confirmed native choice if stale rollback cannot restore it", async () => {
    const { daemon, missionId, orchestrator } = await startMission();
    const apply = orchestrator.updateModel.bind(orchestrator);
    vi.spyOn(orchestrator, "updateModel")
      .mockImplementationOnce(async (choice) => {
        const result = await apply(choice);
        daemon.missions.patch(missionId, (mission) => ({
          ...mission,
          title: "Concurrent title",
        }));
        return result;
      })
      .mockRejectedValueOnce(new Error("Cannot restore"));
    await expect(
      daemon.missions.update(missionId, {
        expectedRevision: daemon.missions.get(missionId).revision,
        orchestrator: NEXT_MODEL,
        worker: NEXT_MODEL,
      })
    ).rejects.toThrow(/could not be restored/u);
    expect(daemon.missions.get(missionId)).toMatchObject({
      orchestrator: NEXT_MODEL,
      title: "Concurrent title",
      worker: MODEL,
    });
    expect(
      daemon.store.getAgent(orchestrator.options.agentId)?.model
    ).toStrictEqual(NEXT_MODEL);
  });

  it("fences a pending native update on pause and ignores a late acknowledgement", async () => {
    const { daemon, missionId, orchestrator } = await startMission();
    const gate = Promise.withResolvers<AgentModelSettings>();
    const entered = Promise.withResolvers<undefined>();
    vi.spyOn(orchestrator, "updateModel").mockImplementationOnce(() => {
      entered.resolve(undefined);
      return gate.promise;
    });
    const { revision } = daemon.missions.get(missionId);
    const updating = Promise.allSettled([
      daemon.missions.update(missionId, {
        expectedRevision: revision,
        orchestrator: NEXT_MODEL,
      }),
    ]);
    await entered.promise;
    await daemon.missions.pause(missionId, {
      expectedRevision: revision,
      operationId: "pause-during-model-update",
    });
    await expect(updating).resolves.toMatchObject([{ status: "rejected" }]);
    gate.resolve(NEXT_MODEL);
    await yieldImmediate();
    expect(daemon.missions.get(missionId)).toMatchObject({
      orchestrator: MODEL,
      status: "paused",
    });
    expect(
      daemon.store.getAgent(orchestrator.options.agentId)?.model
    ).toStrictEqual(MODEL);
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

  it("blocks writes in Plan mode until the live plan revision is approved", async () => {
    const ctx = await startMission(undefined, {
      goal: "Add a greeting file. Plan it first.",
    });
    const { daemon, missionId, orchestrator, repo } = ctx;
    const before = await orchestrator.options.onPermission({
      agentId: orchestrator.options.agentId,
      toolUses: [createEdit(`${repo}/a.txt`)],
    });
    const decision = proposePlan(orchestrator);
    const [plan] = daemon.missions.snapshot(missionId).plans;
    expect([
      orchestrator.interactionModes,
      daemon.missions.get(missionId).status,
      daemon.store.getAgent(orchestrator.options.agentId)?.status,
      plan?.actionable,
      plan?.toolUseId,
    ]).toStrictEqual([
      ["spec"],
      "awaiting_approval",
      "waiting_permission",
      true,
      "spec-1",
    ]);
    expect(() =>
      daemon.missions.decidePlan(missionId, { approve: true, planRevision: 2 })
    ).toThrow(/not found/iu);
    daemon.missions.decidePlan(missionId, { approve: true, planRevision: 1 });
    await expect(decision).resolves.toBeTruthy();
    const after = await orchestrator.options.onPermission({
      agentId: orchestrator.options.agentId,
      toolUses: [createEdit(`${repo}/a.txt`)],
    });
    expect([
      before,
      after,
      daemon.missions.get(missionId).status,
      daemon.missions.get(missionId).executionMode,
      daemon.store.getAgent(orchestrator.options.agentId)?.holdsWriteLease,
    ]).toStrictEqual([false, true, "running", "work", true]);
  });

  it("runs a Worker in the shared workspace and returns its handoff", async () => {
    const ctx = await startMission();
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

  it("delivers worker messages and handoffs through one outbox with sender identity", async () => {
    const ctx = await startMission();
    ctx.orchestrator.consume(`${ctx.missionId}:goal`);
    await ctx.orchestrator.tool("dispatch_worker", {
      instructions: "Research",
      needsWrite: false,
      title: "Research",
    });
    const worker = await waitFor(
      () => ctx.runtimes[1],
      (runtime) => (runtime?.submitted.length ?? 0) > 0
    );
    if (!worker) {
      throw new Error("Missing worker");
    }
    const send = (text: string) =>
      worker.tool("send_message", { messageId: "m1", text, to: "main" });
    const first = await send("Found the cause");
    const replay = await send("Found the cause");
    await expect(send("Something else")).rejects.toThrow(/different message/u);
    const id = `msg:${worker.options.agentId}:m1`;
    await nativelyQueued(ctx.daemon, id);
    ctx.orchestrator.consume(id);
    const delivered = ctx.orchestrator.submitted.filter((s) => s.id === id);
    await worker.tool("submit_handoff", {
      checks: [],
      filesChanged: [],
      followUps: [],
      summary: "Done",
    });
    const [assignment] = ctx.daemon.missions.snapshot(
      ctx.missionId
    ).assignments;
    const handoff = await nativelyQueued(
      ctx.daemon,
      `handoff:${assignment?.id ?? ""}`
    );
    const { transcript } = ctx.daemon.missions.snapshot(ctx.missionId);
    expect({
      first: String(first).includes("accepted"),
      handoff: [handoff.origin, handoff.purpose, handoff.sender?.role],
      records: transcript
        .filter((item) => item.kind === "agent_message")
        .map((item) => [item.purpose, item.sender?.role, item.recipient?.role]),
      replay: String(replay).includes("not sent again"),
      sender: delivered.map((s) => s.options.sender?.kind),
      userEcho: transcript.some(
        (item) => item.kind === "user" && item.requestId === id
      ),
    }).toStrictEqual({
      first: true,
      handoff: ["agent", "handoff", "worker"],
      records: [
        ["assignment", "orchestrator", "worker"],
        ["message", "worker", "orchestrator"],
        ["handoff", "worker", "orchestrator"],
      ],
      replay: true,
      sender: ["agent"],
      userEcho: false,
    });
  });

  it("delivers plain messages in order during Plan mode without changing it", async () => {
    const { daemon, missionId, orchestrator } = await startMission(undefined, {
      goal: "Add a greeting file. Plan it first.",
    });
    const decision = proposePlan(orchestrator);
    const first = await daemon.missions.submitMessage(missionId, {
      mode: "steer",
      operationId: "plan-reply-first",
      text: "Keep the public behavior",
    });
    const second = await daemon.missions.submitMessage(missionId, {
      mode: "queue",
      operationId: "plan-reply-second",
      text: "Include tests",
    });
    await nativelyQueued(daemon, second.id);
    expect({
      mode: daemon.missions.get(missionId).executionMode,
      native: orchestrator.interactionModes,
      order: orchestrator.submitted
        .filter((item) => [first.id, second.id].includes(item.id))
        .map((item) => [item.id, item.mode, item.text]),
      plan: daemon.missions.snapshot(missionId).plans[0]?.actionable,
    }).toStrictEqual({
      mode: "plan",
      native: ["spec"],
      order: [
        [first.id, "steer", first.text],
        [second.id, "queue", second.text],
      ],
      plan: true,
    });
    daemon.missions.decidePlan(missionId, { approve: true, planRevision: 1 });
    await expect(decision).resolves.toBeTruthy();
    expect(daemon.missions.get(missionId).executionMode).toBe("work");
  });

  it.each([false, true])(
    "ignores legacy mode fields in duplicate message identity, journal=%s",
    async (journaled) => {
      const { daemon, missionId, orchestrator } = await startMission();
      orchestrator.consume(`${missionId}:goal`);
      const goal = daemon.store.queue.get(`${missionId}:goal`);
      if (!goal) {
        throw new Error("Missing goal receipt");
      }
      const legacy = {
        ...goal,
        executionMode: "plan",
        id: "legacy-mode-message",
        text: "Keep the public behavior",
      };
      daemon.store.queue.put(legacy);
      if (journaled) {
        daemon.journal.recordCompleted(
          {
            detail: {
              agentId: legacy.agentId,
              executionMode: "plan",
              mode: legacy.mode,
              text: legacy.text,
            },
            id: legacy.id,
            kind: "mission.message",
            missionId,
          },
          legacy
        );
      }
      const request = {
        mode: legacy.mode,
        operationId: legacy.id,
        text: legacy.text,
      };
      const duplicate = await daemon.missions.submitMessage(missionId, request);
      expect(duplicate).toMatchObject({ id: legacy.id, state: "sent" });
      expect(duplicate).not.toHaveProperty("executionMode");
      expect(orchestrator.submitted.map((item) => item.id)).toStrictEqual([
        `${missionId}:goal`,
      ]);
      await expect(
        daemon.missions.submitMessage(missionId, {
          ...request,
          text: "Changed",
        })
      ).rejects.toThrow(
        "This operation ID was already used for another message"
      );
    }
  );

  it("clears live plan approvals left by a crashed daemon", async () => {
    const ctx = await startMission(undefined, {
      goal: "Add a greeting file. Plan it first.",
    });
    const { daemon, missionId, orchestrator } = ctx;
    proposePlan(orchestrator);
    const [live] = daemon.missions.snapshot(missionId).plans;
    vi.spyOn(daemon.supervisor, "stopRecord").mockResolvedValue({
      stopped: true,
      survivors: [],
    });
    await daemon.missions.recover();
    const [recovered] = daemon.missions.snapshot(missionId).plans;
    expect([live?.actionable, recovered?.actionable]).toStrictEqual([
      true,
      false,
    ]);
  });

  it("ends a plan approval with its native request and asks for a fresh one after resume", async () => {
    const ctx = await startMission(undefined, {
      goal: "Add a greeting file. Plan it first.",
    });
    const { daemon, missionId, orchestrator } = ctx;
    const decision = proposePlan(orchestrator);
    const paused = await daemon.missions.pause(missionId, {
      expectedRevision: daemon.missions.get(missionId).revision,
      operationId: "plan-pause",
    });
    await expect(decision).resolves.toBeFalsy();
    const [ended] = daemon.missions.snapshot(missionId).plans;
    expect([ended?.status, ended?.actionable]).toStrictEqual([
      "proposed",
      false,
    ]);
    await daemon.missions.resume(missionId, {
      expectedRevision: paused.revision,
      operationId: "plan-resume",
    });
    expect(() =>
      daemon.missions.decidePlan(missionId, { approve: true, planRevision: 1 })
    ).toThrow(/no longer waiting/u);
    const restarted = await waitFor(
      () => ctx.runtimes[1],
      (runtime) => (runtime?.submitted.length ?? 0) > 0
    );
    const fresh = proposePlan(restarted ?? orchestrator, "1. Write", "Again");
    daemon.missions.decidePlan(missionId, { approve: true, planRevision: 2 });
    await expect(fresh).resolves.toBeTruthy();
    expect([
      restarted?.submitted[0]?.text.includes(
        "present it again with ExitSpecMode"
      ),
      daemon.missions.get(missionId).executionMode,
    ]).toStrictEqual([true, "work"]);
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
    await nativelyQueued(daemon, "queued-msg-1");
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

  it("lets one edit win, replays a retried edit, and never sends twice", async () => {
    const { daemon, missionId, orchestrator } = await startMission();
    await daemon.missions.submitMessage(missionId, {
      mode: "queue",
      operationId: "race-msg",
      text: "first",
    });
    const { revision } = await nativelyQueued(daemon, "race-msg");
    const edit = (operationId: string, expectedRevision = revision) =>
      daemon.missions.editQueueItem(missionId, "race-msg", {
        expectedRevision,
        operationId,
        text: `edited by ${operationId}`,
      });
    const [winner, loser] = await Promise.allSettled([
      edit("race-a"),
      edit("race-b"),
    ]);
    const retried = await edit("race-a");
    const fresh = daemon.store.queue.get("race-msg")?.revision ?? -1;
    await expect(edit("race-c", fresh)).rejects.toThrow(/already removed/u);
    expect({
      loser: loser.status === "rejected" && String(loser.reason),
      retried,
      sent: orchestrator.submitted
        .filter((entry) => entry.id.startsWith("race-"))
        .map((entry) => entry.id),
      winner: winner.status === "fulfilled" && winner.value,
    }).toStrictEqual({
      loser: expect.stringMatching(/already being changed|changed; refresh/u),
      retried: { outcome: "replaced", replacementId: "race-a" },
      sent: ["race-msg", "race-a"],
      winner: { outcome: "replaced", replacementId: "race-a" },
    });
  });

  it("never replays a transport-ambiguous goal and retries it only on request", async () => {
    let failing = true;
    const booted = await boot(undefined, (runtime) => {
      runtime.failSubmits = () => failing;
    });
    const ctx = await createMission(booted);
    const goalId = `${ctx.missionId}:goal`;
    const goal = await waitFor(
      () => ctx.daemon.store.queue.get(goalId),
      (item) => item?.state === "unknown"
    );
    const snapshot = ctx.daemon.missions.snapshot(ctx.missionId);
    expect({
      goalState: goal?.state,
      notice: ctx.daemon.log
        .replay(ctx.missionId, 0)
        .some(
          (event) =>
            event.type === "notice" &&
            event.data.notice.message.includes("uncertain")
        ),
      status: snapshot.mission.status,
    }).toStrictEqual({ goalState: "unknown", notice: true, status: "running" });
    failing = false;
    const [orchestrator] = ctx.runtimes;
    const retry = await ctx.daemon.missions.retryQueueItem(
      ctx.missionId,
      goalId,
      { expectedRevision: goal?.revision ?? -1, operationId: "goal-retry" }
    );
    const replay = await ctx.daemon.missions.retryQueueItem(
      ctx.missionId,
      goalId,
      { expectedRevision: goal?.revision ?? -1, operationId: "goal-retry" }
    );
    await nativelyQueued(ctx.daemon, retry.id);
    expect({
      replay: replay.id,
      retryOf: retry.retryOf,
      sent: orchestrator?.submitted.map((entry) => entry.id),
    }).toStrictEqual({
      replay: retry.id,
      retryOf: goalId,
      sent: [retry.id],
    });
    await expect(
      ctx.daemon.missions.retryQueueItem(ctx.missionId, retry.id, {
        expectedRevision: ctx.daemon.store.queue.get(retry.id)?.revision ?? -1,
        operationId: "retry-queued",
      })
    ).rejects.toThrow(/failed|uncertain|unknown/iu);
    await expect(
      ctx.daemon.missions.retryQueueItem(ctx.missionId, goalId, {
        expectedRevision: ctx.daemon.store.queue.get(goalId)?.revision ?? -1,
        operationId: "goal-retry-again",
      })
    ).rejects.toThrow(/already retried/u);
  });

  it("reports a failed stop and blocks new work until processes are gone", async () => {
    const { daemon, missionId, orchestrator } = await startMission();
    orchestrator.survivors = [4242];
    const control = (operationId: string) => ({
      expectedRevision: daemon.missions.get(missionId).revision,
      operationId,
    });
    const stopped = await daemon.missions.pause(missionId, control("sf-pause"));
    expect([stopped.status, stopped.lastError?.code]).toStrictEqual([
      "stop_failed",
      "stop_failed",
    ]);
    await expect(
      daemon.missions.submitMessage(missionId, {
        mode: "steer",
        operationId: "sf-msg",
        text: "x",
      })
    ).rejects.toThrow(/Resume/u);
    await expect(
      daemon.missions.archive(missionId, control("sf-archive"))
    ).rejects.toThrow(/did not stop/u);
  });

  it("archives only stopped or finished missions and fences them for good", async () => {
    const { daemon, missionId, orchestrator } = await startMission();
    const control = (operationId: string) => ({
      expectedRevision: daemon.missions.get(missionId).revision,
      operationId,
    });
    await expect(
      daemon.missions.archive(missionId, control("archive-early"))
    ).rejects.toThrow(/cannot be archived/u);
    await daemon.missions.pause(missionId, control("archive-pause"));
    const archived = await daemon.missions.archive(
      missionId,
      control("archive-op")
    );
    await expect(
      daemon.missions.resume(missionId, control("archive-resume"))
    ).rejects.toThrow(/Cannot resume/u);
    expect([archived.status, orchestrator.closed]).toStrictEqual([
      "archived",
      true,
    ]);
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

  it("shares startup completion instead of exposing a half-started runtime", async () => {
    const started = Promise.withResolvers<undefined>();
    const booted = await boot(undefined, (runtime) => {
      const start = runtime.start.bind(runtime);
      vi.spyOn(runtime, "start").mockImplementation(async (sessionId) => {
        await started.promise;
        return await start(sessionId);
      });
    });
    const ctx = await createMission(booted);
    const runtime = await waitFor(() => booted.runtimes[0], Boolean);
    const submission = ctx.daemon.missions.submitMessage(ctx.missionId, {
      mode: "queue",
      operationId: "during-start",
      text: "Wait for startup",
    });
    expect(runtime?.submitted).toHaveLength(0);
    started.resolve(undefined);
    await submission;
    await waitFor(
      () => runtime?.submitted.length,
      (count) => count === 2
    );
    expect(runtime?.start).toHaveBeenCalledOnce();
  });

  it("pause joins deferred startup and no caller can submit after its fence", async () => {
    const started = Promise.withResolvers<undefined>();
    const closeEntered = Promise.withResolvers<undefined>();
    const booted = await boot(undefined, (runtime) => {
      const start = runtime.start.bind(runtime);
      vi.spyOn(runtime, "start").mockImplementation(async (sessionId) => {
        await started.promise;
        return await start(sessionId);
      });
      const close = runtime.close.bind(runtime);
      vi.spyOn(runtime, "close").mockImplementation(async () => {
        closeEntered.resolve(undefined);
        return await close();
      });
    });
    const ctx = await createMission(booted);
    const runtime = await waitFor(() => booted.runtimes[0], Boolean);
    const submission = ctx.daemon.missions.submitMessage(ctx.missionId, {
      mode: "queue",
      operationId: "cancelled-start-message",
      text: "Never deliver",
    });
    let settled = false;
    const stopping = ctx.daemon.missions
      .pause(ctx.missionId, {
        expectedRevision: ctx.daemon.missions.get(ctx.missionId).revision,
        operationId: "pause-startup",
      })
      .then((mission) => {
        settled = true;
        return mission;
      });
    await closeEntered.promise;
    expect(settled).toBeFalsy();
    started.resolve(undefined);
    const paused = await stopping;
    await submission;
    expect(paused.status).toBe("paused");
    expect(runtime?.submitted).toHaveLength(0);
    expect(ctx.daemon.missions.snapshot(ctx.missionId).agents[0]?.status).toBe(
      "stopped"
    );
  });

  it("shutdown joins startup and rejects all delayed callbacks", async () => {
    const started = Promise.withResolvers<undefined>();
    const closeEntered = Promise.withResolvers<undefined>();
    const booted = await boot(undefined, (runtime) => {
      const start = runtime.start.bind(runtime);
      vi.spyOn(runtime, "start").mockImplementation(async (sessionId) => {
        await started.promise;
        return await start(sessionId);
      });
      const close = runtime.close.bind(runtime);
      vi.spyOn(runtime, "close").mockImplementation(async () => {
        closeEntered.resolve(undefined);
        return await close();
      });
    });
    await createMission(booted);
    const runtime = await waitFor(() => booted.runtimes[0], Boolean);
    const closing = booted.daemon.close();
    await closeEntered.promise;
    started.resolve(undefined);
    await closing;
    expect(runtime?.submitted).toHaveLength(0);
    expect(() =>
      runtime?.emit({ message: "late", type: "process_exit" })
    ).not.toThrow();
    await expect(runtime?.tool("update_todos", { todos: [] })).rejects.toThrow(
      /paused/u
    );
  });

  it("rejects old queue, permission, question and role callbacks after replacement", async () => {
    const ctx = await startMission();
    const { daemon, missionId, orchestrator } = ctx;
    orchestrator.emit({
      delta: "old preview",
      messageId: "preview",
      type: "text_delta",
    });
    const paused = await daemon.missions.pause(missionId, {
      expectedRevision: daemon.missions.get(missionId).revision,
      operationId: "generation-pause",
    });
    await daemon.missions.resume(missionId, {
      expectedRevision: paused.revision,
      operationId: "generation-resume",
    });
    const current = await waitFor(
      () => ctx.runtimes[1],
      (runtime) => (runtime?.submitted.length ?? 0) > 0
    );
    const before = daemon.log.bounds(missionId).latest;
    orchestrator.consume(`${missionId}:goal`);
    orchestrator.emit({
      delta: "stale",
      messageId: "preview",
      type: "text_delta",
    });
    orchestrator.emit({ message: "old exit", type: "process_exit" });
    const approved = await orchestrator.options.onPermission({
      agentId: orchestrator.options.agentId,
      toolUses: [createEdit(`${ctx.repo}/a.txt`)],
    });
    await expect(
      proposePlan(orchestrator, "stale", "Old", "old-spec")
    ).resolves.toBeFalsy();
    const answer = await orchestrator.options.onAskUser({
      agentId: orchestrator.options.agentId,
      questions: [],
      toolCallId: "old-ask",
    });
    current?.emit({ reason: "done", turnId: null, type: "turn_completed" });
    expect(approved).toBeFalsy();
    expect(answer.cancelled).toBeTruthy();
    expect(daemon.log.replay(missionId, before)).toStrictEqual([]);
    expect(daemon.store.queue.get(`${missionId}:goal`)?.state).toBe("removed");
  });

  it("uses only the latest plan and enforces read-only worker assignments", async () => {
    const ctx = await startMission(undefined, {
      goal: "Add a greeting file. Plan it first.",
    });
    await ctx.orchestrator.tool("dispatch_worker", {
      instructions: "Analyze only",
      needsWrite: false,
      title: "Read",
    });
    const worker = await waitFor(
      () => ctx.runtimes[1],
      (runtime) => (runtime?.submitted.length ?? 0) > 0
    );
    const readOnlyWrite = await worker?.options.onPermission({
      agentId: worker.options.agentId,
      toolUses: [createEdit(`${ctx.repo}/a.txt`)],
    });
    const first = proposePlan(ctx.orchestrator, "Changes", "Revision 1");
    const second = proposePlan(
      ctx.orchestrator,
      "Different changes",
      "Revision 2",
      "spec-2"
    );
    const superseded = await first;
    expect(() =>
      ctx.daemon.missions.decidePlan(ctx.missionId, {
        approve: true,
        planRevision: 1,
      })
    ).toThrow(/already decided or replaced/u);
    const planWrite = await ctx.orchestrator.options.onPermission({
      agentId: ctx.orchestrator.options.agentId,
      toolUses: [createEdit(`${ctx.repo}/a.txt`)],
    });
    await expect(
      ctx.orchestrator.tool("dispatch_worker", {
        instructions: "Write",
        needsWrite: true,
        title: "Blocked",
      })
    ).rejects.toThrow(/Plan mode is read-only/u);
    expect([
      superseded,
      readOnlyWrite,
      planWrite,
      ctx.daemon.missions.get(ctx.missionId).status,
      ctx.daemon.missions
        .snapshot(ctx.missionId)
        .plans.map((plan) => plan.status),
    ]).toStrictEqual([
      false,
      false,
      false,
      "awaiting_approval",
      ["superseded", "proposed"],
    ]);
    ctx.daemon.missions.decidePlan(ctx.missionId, {
      approve: false,
      feedback: "Smaller",
      planRevision: 2,
    });
    const rejected = await second;
    const feedback = await waitFor(
      () => ctx.orchestrator.submitted.at(-1)?.text ?? "",
      (text) => text.includes("requested changes")
    );
    expect([
      rejected,
      feedback.includes("Smaller"),
      ctx.daemon.missions.get(ctx.missionId).executionMode,
    ]).toStrictEqual([false, true, "plan"]);
  });

  it("keeps the writer lease until disposal is confirmed", async () => {
    const ctx = await startMission();
    await ctx.orchestrator.options.onPermission({
      agentId: ctx.orchestrator.options.agentId,
      toolUses: [createEdit(`${ctx.repo}/a.txt`)],
    });
    const closing = Promise.withResolvers<undefined>();
    const closeEntered = Promise.withResolvers<undefined>();
    const close = ctx.orchestrator.close.bind(ctx.orchestrator);
    vi.spyOn(ctx.orchestrator, "close").mockImplementation(async () => {
      closeEntered.resolve(undefined);
      await closing.promise;
      return await close();
    });
    const stopped = ctx.daemon.missions.pause(ctx.missionId, {
      expectedRevision: ctx.daemon.missions.get(ctx.missionId).revision,
      operationId: "lease-pause",
    });
    await closeEntered.promise;
    const lease = ctx.daemon.missions.leases;
    expect(lease.holder(ctx.repo)).toBe(ctx.orchestrator.options.agentId);
    let acquired = false;
    const next = lease.acquire(ctx.repo, "next-writer").then(() => {
      acquired = true;
      return acquired;
    });
    expect(acquired).toBeFalsy();
    closing.resolve(undefined);
    await stopped;
    await next;
    expect(lease.holder(ctx.repo)).toBe("next-writer");
    lease.forget("next-writer");
  });

  it("does not clear the writer flag in an unrelated workspace", async () => {
    const first = await startMission();
    const secondCreated = await createMission(first, "2");
    const secondRuntime = await waitFor(
      () => first.runtimes[1],
      (runtime) => (runtime?.submitted.length ?? 0) > 0
    );
    if (!secondRuntime) {
      throw new Error("Missing second runtime");
    }
    const second = { ...secondCreated, orchestrator: secondRuntime };
    await first.orchestrator.options.onPermission({
      agentId: first.orchestrator.options.agentId,
      toolUses: [createEdit(`${first.repo}/a.txt`)],
    });
    await secondRuntime.options.onPermission({
      agentId: secondRuntime.options.agentId,
      toolUses: [createEdit(`${second.repo}/a.txt`)],
    });
    first.orchestrator.emit({
      reason: "done",
      turnId: null,
      type: "turn_completed",
    });
    expect(
      first.daemon.store.getAgent(secondRuntime.options.agentId)
        ?.holdsWriteLease
    ).toBeTruthy();
  });

  it("reserves a handed-off worker slot until successful retirement", async () => {
    const ctx = await startMission();
    ctx.daemon.settings.update({ maxConcurrentWorkers: 1 });
    await ctx.orchestrator.tool("dispatch_worker", {
      instructions: "First",
      needsWrite: true,
      title: "First",
    });
    const worker = await waitFor(
      () => ctx.runtimes[1],
      (runtime) => (runtime?.submitted.length ?? 0) > 0
    );
    if (!worker) {
      throw new Error("Missing worker");
    }
    const closing = Promise.withResolvers<undefined>();
    const closeEntered = Promise.withResolvers<undefined>();
    const close = worker.close.bind(worker);
    vi.spyOn(worker, "close").mockImplementation(async () => {
      closeEntered.resolve(undefined);
      await closing.promise;
      return await close();
    });
    await worker.tool("submit_handoff", {
      checks: [],
      filesChanged: [],
      followUps: [],
      summary: "Done",
    });
    await closeEntered.promise;
    await ctx.orchestrator.tool("dispatch_worker", {
      instructions: "Second",
      needsWrite: true,
      title: "Second",
    });
    expect(ctx.runtimes).toHaveLength(2);
    closing.resolve(undefined);
    await waitFor(
      () => ctx.runtimes[2],
      (runtime) => (runtime?.submitted.length ?? 0) > 0
    );
    expect(
      ctx.daemon.missions
        .snapshot(ctx.missionId)
        .assignments.map((assignment) => assignment.status)
        .toSorted()
    ).toStrictEqual(["handed_off", "running"]);
  });

  it("a failed retirement keeps queued assignments blocked", async () => {
    const ctx = await startMission();
    ctx.daemon.settings.update({ maxConcurrentWorkers: 1 });
    await ctx.orchestrator.tool("dispatch_worker", {
      instructions: "First",
      needsWrite: true,
      title: "First",
    });
    const worker = await waitFor(
      () => ctx.runtimes[1],
      (runtime) => (runtime?.submitted.length ?? 0) > 0
    );
    if (!worker) {
      throw new Error("Missing worker");
    }
    await ctx.orchestrator.tool("dispatch_worker", {
      instructions: "Second",
      needsWrite: true,
      title: "Second",
    });
    worker.survivors = [4242];
    await worker.tool("submit_handoff", {
      checks: [],
      filesChanged: [],
      followUps: [],
      summary: "Done",
    });
    await waitFor(
      () => ctx.daemon.missions.get(ctx.missionId).status,
      (status) => status === "stop_failed"
    );
    expect(ctx.runtimes).toHaveLength(2);
    expect(
      ctx.daemon.missions
        .snapshot(ctx.missionId)
        .assignments.some((assignment) => assignment.status === "queued")
    ).toBeTruthy();
    worker.survivors = [];
  });

  it("completion cancels decisions and confirms quiescence before publishing", async () => {
    const ctx = await startMission();
    const pendingQuestion = ctx.orchestrator.options.onAskUser({
      agentId: ctx.orchestrator.options.agentId,
      questions: [],
      toolCallId: "complete-question",
    });
    const permission = ctx.orchestrator.options.onPermission({
      agentId: ctx.orchestrator.options.agentId,
      toolUses: [UNCLASSIFIED],
    });
    await waitFor(
      () => ctx.daemon.missions.snapshot(ctx.missionId).permissions.length,
      (count) => count === 1
    );
    const closing = Promise.withResolvers<undefined>();
    const closeEntered = Promise.withResolvers<undefined>();
    const close = ctx.orchestrator.close.bind(ctx.orchestrator);
    vi.spyOn(ctx.orchestrator, "close").mockImplementation(async () => {
      closeEntered.resolve(undefined);
      await closing.promise;
      return await close();
    });
    await ctx.orchestrator.tool("complete_mission", {
      checks: [],
      summary: "Finished",
    });
    await closeEntered.promise;
    const [cancelledQuestion, cancelledPermission] = await Promise.all([
      pendingQuestion,
      permission,
    ]);
    expect([cancelledQuestion.cancelled, cancelledPermission]).toStrictEqual([
      true,
      false,
    ]);
    const effect = vi.fn<() => Promise<string>>(() =>
      Promise.resolve("published")
    );
    await expect(
      ctx.daemon.missions.withWorkspaceMutation(ctx.missionId, effect)
    ).rejects.toThrow(/Stop/u);
    expect(effect).not.toHaveBeenCalled();
    closing.resolve(undefined);
    const completed = await waitFor(
      () => ctx.daemon.missions.get(ctx.missionId),
      (mission) => mission.status === "completed"
    );
    await expect(
      ctx.daemon.missions.withWorkspaceMutation(ctx.missionId, effect)
    ).resolves.toBe("published");
    const paused = await ctx.daemon.missions.pause(ctx.missionId, {
      expectedRevision: completed.revision,
      operationId: "complete-pause",
    });
    const archived = await ctx.daemon.missions.archive(ctx.missionId, {
      expectedRevision: paused.revision,
      operationId: "complete-archive",
    });
    expect([paused.endedAt, archived.endedAt]).toStrictEqual([
      completed.endedAt,
      completed.endedAt,
    ]);
  });

  it("serializes resume admission behind the entire workspace mutation interval", async () => {
    const ctx = await startMission();
    const paused = await ctx.daemon.missions.pause(ctx.missionId, {
      expectedRevision: ctx.daemon.missions.get(ctx.missionId).revision,
      operationId: "publish-pause",
    });
    const entered = Promise.withResolvers<undefined>();
    const release = Promise.withResolvers<undefined>();
    const order: string[] = [];
    const mutation = ctx.daemon.missions.withWorkspaceMutation(
      ctx.missionId,
      async () => {
        order.push("mutation");
        entered.resolve(undefined);
        await release.promise;
        order.push("published");
      }
    );
    await entered.promise;
    const resuming = ctx.daemon.missions
      .resume(ctx.missionId, {
        expectedRevision: paused.revision,
        operationId: "publish-resume",
      })
      .then(() => order.push("resumed"));
    expect(ctx.runtimes).toHaveLength(1);
    release.resolve(undefined);
    await Promise.all([mutation, resuming]);
    expect(order).toStrictEqual(["mutation", "published", "resumed"]);
    expect(ctx.runtimes).toHaveLength(2);
  });

  it("serializes mode changes with edits and preserves the original submit intent", async () => {
    const ctx = await startMission();
    const request = {
      mode: "queue" as const,
      operationId: "mode-item",
      text: "original",
    };
    await ctx.daemon.missions.submitMessage(ctx.missionId, request);
    const item = await nativelyQueued(ctx.daemon, "mode-item");
    const entered = Promise.withResolvers<undefined>();
    const release = Promise.withResolvers<undefined>();
    const change = ctx.orchestrator.changeMode.bind(ctx.orchestrator);
    vi.spyOn(ctx.orchestrator, "changeMode").mockImplementation(
      async (id, mode) => {
        entered.resolve(undefined);
        await release.promise;
        await change(id, mode);
      }
    );
    const changing = ctx.daemon.missions.changeQueueMode(
      ctx.missionId,
      item.id,
      { expectedRevision: item.revision, mode: "steer" }
    );
    await entered.promise;
    await expect(
      ctx.daemon.missions.editQueueItem(ctx.missionId, item.id, {
        expectedRevision: item.revision,
        operationId: "mode-edit",
        text: "edit",
      })
    ).rejects.toThrow(/already being changed/u);
    await expect(
      ctx.daemon.missions.removeQueueItem(ctx.missionId, item.id, item.revision)
    ).rejects.toThrow(/already being changed/u);
    release.resolve(undefined);
    await changing;
    await expect(
      ctx.daemon.missions.submitMessage(ctx.missionId, request)
    ).resolves.toMatchObject({ mode: "steer" });
    await expect(
      ctx.daemon.missions.submitMessage(ctx.missionId, {
        ...request,
        text: "different",
      })
    ).rejects.toThrow(/operation ID/u);
    await expect(
      ctx.daemon.missions.submitMessage(ctx.missionId, {
        ...request,
        operationId: "create-mission-1",
      })
    ).rejects.toThrow(/different action/u);
  });

  it("delegates editing once with durable linkage already established", async () => {
    const ctx = await startMission();
    await ctx.daemon.missions.submitMessage(ctx.missionId, {
      mode: "queue",
      operationId: "edit-owner",
      text: "old",
    });
    const item = await nativelyQueued(ctx.daemon, "edit-owner");
    const edit = ctx.orchestrator.edit.bind(ctx.orchestrator);
    const editing = vi
      .spyOn(ctx.orchestrator, "edit")
      .mockImplementation(async (id, replacement, text) => {
        expect(ctx.daemon.store.queue.get(id)?.replacedById).toBe(replacement);
        expect(ctx.daemon.store.queue.get(replacement)?.replacesId).toBe(id);
        return await edit(id, replacement, text);
      });
    const request = {
      expectedRevision: item.revision,
      operationId: "edit-owner-replacement",
      text: "new",
    };
    await ctx.daemon.missions.editQueueItem(ctx.missionId, item.id, request);
    await ctx.daemon.missions.editQueueItem(ctx.missionId, item.id, request);
    expect(editing).toHaveBeenCalledOnce();
    await expect(
      ctx.daemon.missions.editQueueItem(ctx.missionId, item.id, {
        ...request,
        text: "wrong intent",
      })
    ).rejects.toThrow(/operation ID/u);
  });

  it("restores authoritative messages and reconciles consumed queue entries without replay", async () => {
    const ctx = await startMission();
    const goalId = `${ctx.missionId}:goal`;
    const paused = await ctx.daemon.missions.pause(ctx.missionId, {
      expectedRevision: ctx.daemon.missions.get(ctx.missionId).revision,
      operationId: "restore-pause",
    });
    // Restored transcript evidence can arrive after a locally confirmed removal.
    const createRuntime = ctx.runtimes[0]?.options;
    expect(createRuntime).toBeDefined();
    const original = FakeRuntime.prototype.start;
    const start = vi
      .spyOn(FakeRuntime.prototype, "start")
      .mockImplementation(async function start(this: FakeRuntime, sessionId) {
        const result = await original.call(this, sessionId);
        return {
          ...result,
          messages: [
            {
              id: "restored-goal",
              requestId: goalId,
              role: "user" as const,
              sender: null,
              text: "Add a greeting file",
              thinking: "",
              toolResults: [],
              toolUses: [],
            },
          ],
        };
      });
    try {
      await ctx.daemon.missions.resume(ctx.missionId, {
        expectedRevision: paused.revision,
        operationId: "restore-resume",
      });
      const snapshot = ctx.daemon.missions.snapshot(ctx.missionId);
      expect(snapshot.queue.find((item) => item.id === goalId)?.state).toBe(
        "sent"
      );
      expect(
        snapshot.transcript.some((item) => item.requestId === goalId)
      ).toBeTruthy();
      expect(
        ctx.runtimes[1]?.submitted.some((item) => item.id === goalId)
      ).toBeFalsy();
    } finally {
      start.mockRestore();
    }
  });

  it("keeps a goal accepted when startup proved it was never submitted", async () => {
    let failStart = true;
    const booted = await boot(undefined, (runtime) => {
      const start = runtime.start.bind(runtime);
      vi.spyOn(runtime, "start").mockImplementation(async (sessionId) => {
        if (failStart) {
          throw new Error("initialization rejected");
        }
        return await start(sessionId);
      });
    });
    const ctx = await createMission(booted);
    const failed = await waitFor(
      () => ctx.daemon.missions.get(ctx.missionId),
      (mission) => mission.status === "failed"
    );
    expect([
      ctx.runtimes[0]?.closed,
      ctx.daemon.store.queue.get(`${ctx.missionId}:goal`)?.state,
    ]).toStrictEqual([true, "accepted"]);
    failStart = false;
    await ctx.daemon.missions.resume(ctx.missionId, {
      expectedRevision: failed.revision,
      operationId: "retry-initialization",
    });
    await waitFor(
      () => ctx.runtimes[1]?.submitted.length ?? 0,
      (count) => count > 0
    );
    expect(ctx.runtimes[1]?.submitted.map((item) => item.id)).toStrictEqual([
      `${ctx.missionId}:goal`,
    ]);
  });

  it("unexpected worker exit settles the assignment and pumps only after disposal", async () => {
    const ctx = await startMission();
    ctx.daemon.settings.update({ maxConcurrentWorkers: 1 });
    await ctx.orchestrator.tool("dispatch_worker", {
      instructions: "First",
      needsWrite: true,
      title: "First",
    });
    const worker = await waitFor(
      () => ctx.runtimes[1],
      (runtime) => (runtime?.submitted.length ?? 0) > 0
    );
    if (!worker) {
      throw new Error("Missing worker");
    }
    await ctx.orchestrator.tool("dispatch_worker", {
      instructions: "Second",
      needsWrite: true,
      title: "Second",
    });
    const release = Promise.withResolvers<undefined>();
    const entered = Promise.withResolvers<undefined>();
    const close = worker.close.bind(worker);
    vi.spyOn(worker, "close").mockImplementation(async () => {
      entered.resolve(undefined);
      await release.promise;
      return await close();
    });
    worker.emit({ message: "connection lost", type: "process_exit" });
    await entered.promise;
    expect(ctx.runtimes).toHaveLength(2);
    release.resolve(undefined);
    await waitFor(
      () => ctx.runtimes[2],
      (runtime) => (runtime?.submitted.length ?? 0) > 0
    );
    expect(
      ctx.daemon.missions
        .snapshot(ctx.missionId)
        .assignments.map((assignment) => assignment.status)
        .toSorted()
    ).toStrictEqual(["failed", "running"]);
  });

  it("tool call correlation is agent-scoped and discarded with its generation", async () => {
    const ctx = await startMission();
    await ctx.orchestrator.tool("dispatch_worker", {
      instructions: "Work",
      needsWrite: true,
      title: "Worker",
    });
    const worker = await waitFor(
      () => ctx.runtimes[1],
      (runtime) => (runtime?.submitted.length ?? 0) > 0
    );
    const after = ctx.daemon.log.bounds(ctx.missionId).latest;
    ctx.orchestrator.emit({
      input: { path: "orchestrator.txt" },
      name: "Create",
      toolUseId: "same",
      type: "tool_call",
    });
    worker?.emit({
      input: { path: "worker.txt" },
      name: "Create",
      toolUseId: "same",
      type: "tool_call",
    });
    ctx.orchestrator.emit({
      content: "done",
      isError: false,
      toolUseId: "same",
      type: "tool_result",
    });
    worker?.emit({
      content: "done",
      isError: false,
      toolUseId: "same",
      type: "tool_result",
    });
    expect(
      ctx.daemon.log
        .replay(ctx.missionId, after)
        .filter((event) => event.type === "workspace.changed")
        .map((event) => event.data.paths)
    ).toStrictEqual([["orchestrator.txt"], ["worker.txt"]]);
    ctx.orchestrator.emit({
      input: { path: "abandoned.txt" },
      name: "Create",
      toolUseId: "abandoned",
      type: "tool_call",
    });
    const paused = await ctx.daemon.missions.pause(ctx.missionId, {
      expectedRevision: ctx.daemon.missions.get(ctx.missionId).revision,
      operationId: "tools-pause",
    });
    await ctx.daemon.missions.resume(ctx.missionId, {
      expectedRevision: paused.revision,
      operationId: "tools-resume",
    });
    const current = ctx.runtimes.at(-1);
    const resumed = ctx.daemon.log.bounds(ctx.missionId).latest;
    current?.emit({
      content: "unmatched",
      isError: false,
      toolUseId: "abandoned",
      type: "tool_result",
    });
    expect(
      ctx.daemon.log
        .replay(ctx.missionId, resumed)
        .filter((event) => event.type === "workspace.changed")
    ).toStrictEqual([]);
  });

  it("recovers failed process disposal truthfully and requires confirmed Resume", async () => {
    const ctx = await startMission();
    const repository = new ProcessRecordRepository(ctx.daemon.store);
    const { agentId } = ctx.orchestrator.options;
    repository.save(
      { agentId, pid: 4242, startTime: "1", tag: "test-generation" },
      agentId
    );
    const stop = vi
      .spyOn(ctx.daemon.supervisor, "stopRecord")
      .mockResolvedValue({ stopped: false, survivors: [4242] });
    await ctx.daemon.missions.recover();
    const recovered = ctx.daemon.missions.get(ctx.missionId);
    expect([
      recovered.status,
      recovered.lastError?.code,
      ctx.daemon.store.getAgent(agentId)?.status,
      repository.list().length,
    ]).toStrictEqual(["stop_failed", "stop_failed", "failed", 1]);
    await expect(
      ctx.daemon.missions.resume(ctx.missionId, {
        expectedRevision: recovered.revision,
        operationId: "recover-still-running",
      })
    ).rejects.toThrow(/still running/u);
    stop.mockResolvedValue({ stopped: true, survivors: [] });
    const resumed = await ctx.daemon.missions.resume(ctx.missionId, {
      expectedRevision: ctx.daemon.missions.get(ctx.missionId).revision,
      operationId: "recover-confirmed",
    });
    expect([resumed.status, repository.list()]).toStrictEqual(["running", []]);
  });

  it("rejects replaying another mission's message operation ID", async () => {
    const ctx = await startMission();
    const first = await ctx.daemon.missions.submitMessage(ctx.missionId, {
      mode: "queue",
      operationId: "scoped-message",
      text: "same text",
    });
    const other = await createMission(ctx, "other");
    await expect(
      ctx.daemon.missions.submitMessage(other.missionId, {
        mode: first.mode,
        operationId: first.id,
        text: first.text,
      })
    ).rejects.toThrow(/different action or mission/u);
  });

  it("retains a failed edit outcome instead of retrying cancellation on duplicate", async () => {
    const ctx = await startMission();
    await ctx.daemon.missions.submitMessage(ctx.missionId, {
      mode: "queue",
      operationId: "unconfirmed-original",
      text: "old",
    });
    const item = await nativelyQueued(ctx.daemon, "unconfirmed-original");
    const edit = vi
      .spyOn(ctx.orchestrator, "edit")
      .mockResolvedValue("delete_unconfirmed");
    const request = {
      expectedRevision: item.revision,
      operationId: "unconfirmed-replacement",
      text: "new",
    };
    const first = await ctx.daemon.missions.editQueueItem(
      ctx.missionId,
      item.id,
      request
    );
    const replay = await ctx.daemon.missions.editQueueItem(
      ctx.missionId,
      item.id,
      request
    );
    expect([
      first,
      replay,
      edit.mock.calls.length,
      ctx.daemon.store.queue.get(item.id)?.replacedById,
    ]).toStrictEqual([
      { outcome: "delete_unconfirmed", replacementId: null },
      { outcome: "delete_unconfirmed", replacementId: null },
      1,
      null,
    ]);
  });

  it("retiring one worker invalidates only its pending decisions", async () => {
    const ctx = await startMission();
    await ctx.orchestrator.tool("dispatch_worker", {
      instructions: "Work",
      needsWrite: true,
      title: "Worker",
    });
    const worker = await waitFor(
      () => ctx.runtimes[1],
      (runtime) => (runtime?.submitted.length ?? 0) > 0
    );
    if (!worker) {
      throw new Error("Missing worker");
    }
    const orchestratorDecision = ctx.orchestrator.options.onPermission({
      agentId: ctx.orchestrator.options.agentId,
      toolUses: [UNCLASSIFIED],
    });
    const workerDecision = worker.options.onPermission({
      agentId: worker.options.agentId,
      toolUses: [UNCLASSIFIED],
    });
    await waitFor(
      () => ctx.daemon.missions.snapshot(ctx.missionId).permissions.length,
      (count) => count === 2
    );
    await worker.tool("submit_handoff", {
      checks: [],
      filesChanged: [],
      followUps: [],
      summary: "Done",
    });
    await expect(workerDecision).resolves.toBeFalsy();
    const remaining = ctx.daemon.missions.snapshot(ctx.missionId).permissions;
    expect(remaining.map((request) => request.agentId)).toStrictEqual([
      ctx.orchestrator.options.agentId,
    ]);
    const [request] = remaining;
    if (!request) {
      throw new Error("Missing orchestrator decision");
    }
    ctx.daemon.missions.decidePermission(ctx.missionId, request.id, {
      decision: "deny",
      epoch: request.epoch,
    });
    await expect(orchestratorDecision).resolves.toBeFalsy();
  });

  it("retirement cancels lease waits without handing off a still-running writer", async () => {
    const ctx = await startMission();
    await ctx.orchestrator.options.onPermission({
      agentId: ctx.orchestrator.options.agentId,
      toolUses: [createEdit(`${ctx.repo}/a.txt`)],
    });
    await ctx.orchestrator.tool("dispatch_worker", {
      instructions: "Work",
      needsWrite: true,
      title: "Worker",
    });
    const worker = await waitFor(
      () => ctx.runtimes[1],
      (runtime) => (runtime?.submitted.length ?? 0) > 0
    );
    if (!worker) {
      throw new Error("Missing worker");
    }
    const waiting = worker.options.onPermission({
      agentId: worker.options.agentId,
      toolUses: [createEdit(`${ctx.repo}/b.txt`)],
    });
    await waitFor(
      () => ctx.daemon.missions.leases.waiting(ctx.repo),
      (waiters) => waiters.includes(worker.options.agentId)
    );
    await worker.tool("submit_handoff", {
      checks: [],
      filesChanged: [],
      followUps: [],
      summary: "Done",
    });
    await expect(waiting).resolves.toBeFalsy();
    expect([
      ctx.daemon.missions.leases.holder(ctx.repo),
      ctx.daemon.missions.leases.waiting(ctx.repo),
    ]).toStrictEqual([ctx.orchestrator.options.agentId, []]);
  });

  it("a newer pause supersedes a pending completion without publishing completed", async () => {
    const ctx = await startMission();
    const entered = Promise.withResolvers<undefined>();
    const release = Promise.withResolvers<undefined>();
    const close = ctx.orchestrator.close.bind(ctx.orchestrator);
    vi.spyOn(ctx.orchestrator, "close").mockImplementation(async () => {
      entered.resolve(undefined);
      await release.promise;
      return await close();
    });
    await ctx.orchestrator.tool("complete_mission", {
      checks: [],
      summary: "Candidate completion",
    });
    await entered.promise;
    const after = ctx.daemon.log.bounds(ctx.missionId).latest;
    const pausing = ctx.daemon.missions.pause(ctx.missionId, {
      expectedRevision: ctx.daemon.missions.get(ctx.missionId).revision,
      operationId: "superseding-pause",
    });
    release.resolve(undefined);
    await pausing;
    expect([
      ctx.daemon.missions.get(ctx.missionId).status,
      ctx.daemon.missions.get(ctx.missionId).summary,
    ]).toStrictEqual(["paused", null]);
    expect(
      ctx.daemon.log
        .replay(ctx.missionId, after)
        .some(
          (event) =>
            event.type === "mission.updated" &&
            event.data.mission.status === "completed"
        )
    ).toBeFalsy();
  });

  it("worker startup failure retires its execution and advances queued assignments", async () => {
    const release = Promise.withResolvers<undefined>();
    const entered = Promise.withResolvers<undefined>();
    const booted = await boot(undefined, (runtime, index) => {
      if (index !== 1) {
        return;
      }
      vi.spyOn(runtime, "start").mockImplementation(async () => {
        entered.resolve(undefined);
        await release.promise;
        throw new Error("worker initialization failed");
      });
    });
    const created = await createMission(booted);
    const orchestrator = await waitFor(
      () => booted.runtimes[0],
      (runtime) => (runtime?.submitted.length ?? 0) > 0
    );
    if (!orchestrator) {
      throw new Error("Missing orchestrator");
    }
    const ctx = { ...created, orchestrator };
    ctx.daemon.settings.update({ maxConcurrentWorkers: 1 });
    await orchestrator.tool("dispatch_worker", {
      instructions: "First",
      needsWrite: true,
      title: "First",
    });
    await entered.promise;
    await orchestrator.tool("dispatch_worker", {
      instructions: "Second",
      needsWrite: true,
      title: "Second",
    });
    release.resolve(undefined);
    await waitFor(
      () => booted.runtimes[2],
      (runtime) => (runtime?.submitted.length ?? 0) > 0
    );
    expect([
      booted.runtimes[1]?.closed,
      ctx.daemon.missions
        .snapshot(ctx.missionId)
        .assignments.map((assignment) => assignment.status)
        .toSorted(),
    ]).toStrictEqual([true, ["failed", "running"]]);
  });

  it("drains every internal owner before SQLite closes when another cleanup rejects", async () => {
    const ctx = await startMission();
    await createMission(ctx, "shutdown-peer");
    const second = await waitFor(
      () => ctx.runtimes[1],
      (runtime) => (runtime?.submitted.length ?? 0) > 0
    );
    if (!second) {
      throw new Error("Missing second runtime");
    }
    const release = Promise.withResolvers<undefined>();
    const rejected = Promise.withResolvers<undefined>();
    let finalWrite = false;
    const close = second.close.bind(second);
    vi.spyOn(second, "close").mockImplementation(async () => {
      await release.promise;
      ctx.daemon.store.putSetting("deferred-owner-final-write", true);
      finalWrite = true;
      return await close();
    });
    const putAgent = ctx.daemon.store.putAgent.bind(ctx.daemon.store);
    let failCleanup = true;
    const failure = new Error("agent persistence cleanup failed");
    vi.spyOn(ctx.daemon.store, "putAgent").mockImplementation((agent) => {
      if (
        failCleanup &&
        agent.id === ctx.orchestrator.options.agentId &&
        agent.status === "stopped"
      ) {
        failCleanup = false;
        rejected.resolve(undefined);
        throw failure;
      }
      return putAgent(agent);
    });
    // This test deliberately expects daemon shutdown to remain rejected on repeat.
    opened.splice(opened.indexOf(ctx.daemon), 1);
    const closing = ctx.daemon.close();
    let completed = false;
    const observed = Promise.allSettled([closing]).then((results) => {
      completed = true;
      return results;
    });
    const shutdown = ctx.daemon.missions.shutdown();
    expect(ctx.daemon.missions.shutdown()).toBe(shutdown);
    try {
      await rejected.promise;
      await yieldImmediate();
      ctx.daemon.store.putSetting("open-after-cleanup-rejection", true);
      expect([
        completed,
        ctx.daemon.store.getSetting("open-after-cleanup-rejection"),
      ]).toStrictEqual([false, true]);
    } finally {
      release.resolve(undefined);
    }
    const results = await observed;
    const missionResults = await Promise.allSettled([shutdown]);
    expect([finalWrite, results, missionResults]).toMatchObject([
      true,
      [
        {
          reason: {
            errors: [{ message: "Mission shutdown failed" }],
            message: "Daemon shutdown failed",
          },
          status: "rejected",
        },
      ],
      [
        {
          reason: {
            errors: [
              { errors: [failure], message: "Agent execution cleanup failed" },
            ],
            message: "Mission shutdown failed",
          },
          status: "rejected",
        },
      ],
    ]);
    expect(() =>
      ctx.daemon.store.getSetting("deferred-owner-final-write")
    ).toThrow(/not open/u);
    expect(ctx.daemon.missions.shutdown()).toBe(shutdown);
  });

  it.each([false, true])(
    "hard-stops a hung interrupt and preserves observed consumption=%s",
    async (consumed) => {
      const ctx = await startMission();
      const interrupt = Promise.withResolvers<undefined>();
      vi.spyOn(ctx.orchestrator, "interrupt").mockReturnValue(
        interrupt.promise
      );
      const remove = vi.spyOn(ctx.orchestrator, "remove");
      const goal = `${ctx.missionId}:goal`;
      const close = ctx.orchestrator.close.bind(ctx.orchestrator);
      const closing = vi
        .spyOn(ctx.orchestrator, "close")
        .mockImplementation(async () => {
          if (consumed) {
            ctx.orchestrator.queue.consumed(goal);
          }
          return await close();
        });
      const paused = await ctx.daemon.missions.pause(ctx.missionId, {
        expectedRevision: ctx.daemon.missions.get(ctx.missionId).revision,
        operationId: "hung-interrupt-pause",
      });
      expect([
        paused.status,
        closing.mock.calls.length,
        ctx.daemon.store.queue.get(goal)?.state,
      ]).toStrictEqual(["paused", 1, consumed ? "sent" : "unknown"]);
      await ctx.daemon.close();
      interrupt.resolve(undefined);
      await yieldImmediate();
      expect(remove).not.toHaveBeenCalled();
      expect(() =>
        ctx.orchestrator.emit({
          message: "late callback",
          type: "process_exit",
        })
      ).not.toThrow();
    }
  );

  it("retains the lease when hard close cannot confirm stopped despite a hung interrupt", async () => {
    const ctx = await startMission();
    await ctx.orchestrator.options.onPermission({
      agentId: ctx.orchestrator.options.agentId,
      toolUses: [createEdit(`${ctx.repo}/a.txt`)],
    });
    const interrupt = Promise.withResolvers<undefined>();
    vi.spyOn(ctx.orchestrator, "interrupt").mockReturnValue(interrupt.promise);
    const close = vi.spyOn(ctx.orchestrator, "close").mockResolvedValue({
      stopped: false,
      survivors: [4242],
    });
    const paused = await ctx.daemon.missions.pause(ctx.missionId, {
      expectedRevision: ctx.daemon.missions.get(ctx.missionId).revision,
      operationId: "hung-stop-failure",
    });
    expect([
      paused.status,
      paused.lastError?.code,
      ctx.daemon.missions.leases.holder(ctx.repo),
    ]).toStrictEqual([
      "stop_failed",
      "stop_failed",
      ctx.orchestrator.options.agentId,
    ]);
    close.mockResolvedValue({ stopped: true, survivors: [] });
    await ctx.daemon.missions.resume(ctx.missionId, {
      expectedRevision: paused.revision,
      operationId: "hung-stop-confirmed",
    });
    interrupt.resolve(undefined);
    await yieldImmediate();
    expect(ctx.daemon.missions.leases.holder(ctx.repo)).toBeNull();
  });

  it("does not wait for an unconfirmed native delete or persist its late reply after close", async () => {
    const ctx = await startMission();
    const deletion = Promise.withResolvers<undefined>();
    const entered = Promise.withResolvers<undefined>();
    vi.spyOn(ctx.orchestrator, "remove").mockImplementation(async (id) => {
      ctx.orchestrator.queue.removing(id);
      entered.resolve(undefined);
      await deletion.promise;
      ctx.orchestrator.queue.removeConfirmed(id);
      return "removed";
    });
    const pausing = ctx.daemon.missions.pause(ctx.missionId, {
      expectedRevision: ctx.daemon.missions.get(ctx.missionId).revision,
      operationId: "hung-delete-pause",
    });
    await entered.promise;
    await pausing;
    expect([
      ctx.orchestrator.closed,
      ctx.daemon.store.queue.get(`${ctx.missionId}:goal`)?.state,
    ]).toStrictEqual([true, "unknown"]);
    await ctx.daemon.close();
    deletion.resolve(undefined);
    await yieldImmediate();
    expect(ctx.orchestrator.queue.get(`${ctx.missionId}:goal`)?.state).toBe(
      "removed"
    );
  });

  it("settles admitted queue mutations on their owner fence without waiting for a hung SDK reply", async () => {
    const ctx = await startMission();
    const submission = Promise.withResolvers<undefined>();
    const entered = Promise.withResolvers<undefined>();
    const interrupt = Promise.withResolvers<undefined>();
    vi.spyOn(ctx.orchestrator, "interrupt").mockReturnValue(interrupt.promise);
    vi.spyOn(ctx.orchestrator, "submit").mockImplementation(
      async (id, text, mode) => {
        ctx.orchestrator.queue.submitted(id, text, mode);
        entered.resolve(undefined);
        await submission.promise;
        ctx.orchestrator.queue.admitted(id);
      }
    );
    const accepted = await ctx.daemon.missions.submitMessage(ctx.missionId, {
      mode: "queue",
      operationId: "hung-submission",
      text: "Ambiguous delivery",
    });
    expect(accepted.state).toBe("accepted");
    await entered.promise;
    await ctx.daemon.missions.pause(ctx.missionId, {
      expectedRevision: ctx.daemon.missions.get(ctx.missionId).revision,
      operationId: "hung-submission-pause",
    });
    expect(ctx.daemon.store.queue.get("hung-submission")?.state).toBe(
      "unknown"
    );
    await ctx.daemon.close();
    submission.resolve(undefined);
    interrupt.resolve(undefined);
    await yieldImmediate();
    expect(ctx.orchestrator.closed).toBeTruthy();
  });

  it.each(["unknown", "intent"] as const)(
    "recovers a removed archived workspace from a %s removal only",
    async (status) => {
      const ctx = await startMission();
      const paused = await ctx.daemon.missions.pause(ctx.missionId, {
        expectedRevision: ctx.daemon.missions.get(ctx.missionId).revision,
        operationId: "cleanup-recovery-pause",
      });
      await ctx.daemon.missions.archive(ctx.missionId, {
        expectedRevision: paused.revision,
        operationId: "cleanup-recovery-archive",
      });
      saveCleanupOperation(ctx, "uncertain-removal", { status });
      const effect = vi.fn<() => Promise<string>>(() => {
        ctx.daemon.journal.reconcile("uncertain-removal", "reconciled", {
          removed: true,
        });
        return Promise.resolve("reconciled");
      });
      await expect(
        ctx.daemon.missions.withWorkspaceMutation(ctx.missionId, effect)
      ).rejects.toThrow(/Stop/u);
      await rename(ctx.repo, `${ctx.repo}-removed`);
      await expect(
        ctx.daemon.missions.withWorkspaceMutation(ctx.missionId, effect)
      ).rejects.toMatchObject({ code: "ENOENT" });
      await expect(
        ctx.daemon.missions.withWorkspaceRecovery(
          ctx.missionId,
          "uncertain-removal",
          effect
        )
      ).resolves.toBe("reconciled");
      expect([
        ctx.daemon.journal.get("uncertain-removal")?.operation.status,
        ctx.daemon.missions.get(ctx.missionId).status,
        effect.mock.calls.length,
      ]).toStrictEqual(["reconciled", "archived", 1]);
      await expect(
        ctx.daemon.missions.withWorkspaceRecovery(
          ctx.missionId,
          "uncertain-removal",
          effect
        )
      ).rejects.toThrow(/uncertain workspace removal/u);
    }
  );

  it.each([
    { changes: null, label: "a missing operation" },
    { changes: { kind: "mission.pause" }, label: "a different kind" },
    { changes: { missionId: "another-mission" }, label: "a different mission" },
    { changes: { detail: { action: "keep" } }, label: "a keep action" },
    { changes: { detail: {} }, label: "a missing action" },
    { changes: { status: "succeeded" }, label: "a succeeded operation" },
    { changes: { status: "reconciled" }, label: "a reconciled operation" },
    { changes: { status: "failed" }, label: "a failed operation" },
  ] satisfies { label: string; changes: Partial<Operation> | null }[])(
    "rejects workspace recovery for $label",
    async ({ changes }) => {
      const ctx = await startMission();
      await ctx.daemon.missions.pause(ctx.missionId, {
        expectedRevision: ctx.daemon.missions.get(ctx.missionId).revision,
        operationId: "invalid-cleanup-pause",
      });
      if (changes) {
        saveCleanupOperation(ctx, "invalid-cleanup", changes);
      }
      const effect = vi.fn<() => Promise<string>>(() =>
        Promise.resolve("must not run")
      );
      await expect(
        ctx.daemon.missions.withWorkspaceRecovery(
          ctx.missionId,
          "invalid-cleanup",
          effect
        )
      ).rejects.toMatchObject({ code: "conflict" });
      expect(effect).not.toHaveBeenCalled();
    }
  );

  it.each(["running", "stop_failed"] as const)(
    "blocks recovery for a persisted %s owner even when the directory is absent",
    async (status) => {
      const ctx = await startMission();
      await ctx.daemon.missions.pause(ctx.missionId, {
        expectedRevision: ctx.daemon.missions.get(ctx.missionId).revision,
        operationId: "owner-cleanup-pause",
      });
      saveCleanupOperation(ctx, "owner-cleanup");
      ctx.daemon.missions.patch(ctx.missionId, (mission) => ({
        ...mission,
        status,
      }));
      await rename(ctx.repo, `${ctx.repo}-removed`);
      const effect = vi.fn<() => Promise<string>>(() =>
        Promise.resolve("must not run")
      );
      await expect(
        ctx.daemon.missions.withWorkspaceRecovery(
          ctx.missionId,
          "owner-cleanup",
          effect
        )
      ).rejects.toThrow(/still own/u);
      expect(effect).not.toHaveBeenCalled();
    }
  );

  it("blocks cleanup recovery while another mission sharing the workspace starts, runs or retires", async () => {
    const startup = Promise.withResolvers<undefined>();
    const booted = await boot(undefined, (runtime, index) => {
      if (index !== 1) {
        return;
      }
      const start = runtime.start.bind(runtime);
      vi.spyOn(runtime, "start").mockImplementation(async (sessionId) => {
        await startup.promise;
        return await start(sessionId);
      });
    });
    const ctx = await createMission(booted);
    await waitFor(
      () => ctx.runtimes[0]?.submitted.length ?? 0,
      (count) => count > 0
    );
    await ctx.daemon.missions.pause(ctx.missionId, {
      expectedRevision: ctx.daemon.missions.get(ctx.missionId).revision,
      operationId: "shared-cleanup-pause",
    });
    saveCleanupOperation(ctx, "shared-cleanup");
    const peer = await createMission(ctx, "shared-cleanup-peer", ctx.repo);
    const runtime = await waitFor(() => ctx.runtimes[1], Boolean);
    if (!runtime) {
      throw new Error("Missing peer runtime");
    }
    const effect = vi.fn<() => Promise<string>>(() =>
      Promise.resolve("observed")
    );
    try {
      await expect(
        ctx.daemon.missions.withWorkspaceRecovery(
          ctx.missionId,
          "shared-cleanup",
          effect
        )
      ).rejects.toThrow(/still owns/u);
    } finally {
      startup.resolve(undefined);
    }
    await waitFor(
      () => runtime.submitted.length,
      (count) => count > 0
    );
    await expect(
      ctx.daemon.missions.withWorkspaceRecovery(
        ctx.missionId,
        "shared-cleanup",
        effect
      )
    ).rejects.toThrow(/still owns/u);
    const entered = Promise.withResolvers<undefined>();
    const release = Promise.withResolvers<undefined>();
    const close = runtime.close.bind(runtime);
    vi.spyOn(runtime, "close").mockImplementation(async () => {
      entered.resolve(undefined);
      await release.promise;
      return await close();
    });
    const pausing = ctx.daemon.missions.pause(peer.missionId, {
      expectedRevision: ctx.daemon.missions.get(peer.missionId).revision,
      operationId: "shared-peer-pause",
    });
    await entered.promise;
    try {
      await expect(
        ctx.daemon.missions.withWorkspaceRecovery(
          ctx.missionId,
          "shared-cleanup",
          effect
        )
      ).rejects.toThrow(/still owns/u);
    } finally {
      release.resolve(undefined);
    }
    await pausing;
    await expect(
      ctx.daemon.missions.withWorkspaceRecovery(
        ctx.missionId,
        "shared-cleanup",
        effect
      )
    ).resolves.toBe("observed");
    expect(effect).toHaveBeenCalledOnce();
  });

  it("serializes normal resume admission behind cleanup recovery", async () => {
    const ctx = await startMission();
    const paused = await ctx.daemon.missions.pause(ctx.missionId, {
      expectedRevision: ctx.daemon.missions.get(ctx.missionId).revision,
      operationId: "recovery-admission-pause",
    });
    saveCleanupOperation(ctx, "admission-cleanup");
    const entered = Promise.withResolvers<undefined>();
    const release = Promise.withResolvers<undefined>();
    const order: string[] = [];
    const recovery = ctx.daemon.missions.withWorkspaceRecovery(
      ctx.missionId,
      "admission-cleanup",
      async () => {
        entered.resolve(undefined);
        await release.promise;
        order.push("recovered");
      }
    );
    await entered.promise;
    const resuming = ctx.daemon.missions
      .resume(ctx.missionId, {
        expectedRevision: paused.revision,
        operationId: "recovery-admission-resume",
      })
      .then(() => order.push("resumed"));
    expect(ctx.runtimes).toHaveLength(1);
    release.resolve(undefined);
    await Promise.all([recovery, resuming]);
    expect([order, ctx.runtimes.length]).toStrictEqual([
      ["recovered", "resumed"],
      2,
    ]);
  });

  it("revalidates cleanup intent after waiting for normal workspace exclusion", async () => {
    const ctx = await startMission();
    await ctx.daemon.missions.pause(ctx.missionId, {
      expectedRevision: ctx.daemon.missions.get(ctx.missionId).revision,
      operationId: "queued-cleanup-pause",
    });
    saveCleanupOperation(ctx, "queued-cleanup");
    const entered = Promise.withResolvers<undefined>();
    const release = Promise.withResolvers<undefined>();
    const mutation = ctx.daemon.missions.withWorkspaceMutation(
      ctx.missionId,
      async () => {
        entered.resolve(undefined);
        await release.promise;
      }
    );
    await entered.promise;
    const effect = vi.fn<() => Promise<string>>(() =>
      Promise.resolve("must not replay")
    );
    const recovery = ctx.daemon.missions.withWorkspaceRecovery(
      ctx.missionId,
      "queued-cleanup",
      effect
    );
    ctx.daemon.journal.reconcile("queued-cleanup", "reconciled", {
      removed: true,
    });
    release.resolve(undefined);
    await mutation;
    await expect(recovery).rejects.toThrow(/uncertain workspace removal/u);
    expect(effect).not.toHaveBeenCalled();
  });

  it("rejects cleanup recovery after daemon shutdown without touching closed persistence", async () => {
    const ctx = await startMission();
    saveCleanupOperation(ctx, "closed-cleanup");
    await ctx.daemon.close();
    const effect = vi.fn<() => Promise<string>>(() =>
      Promise.resolve("must not run")
    );
    await expect(
      ctx.daemon.missions.withWorkspaceRecovery(
        ctx.missionId,
        "closed-cleanup",
        effect
      )
    ).rejects.toThrow(/daemon is stopping/u);
    expect(effect).not.toHaveBeenCalled();
  });
});
