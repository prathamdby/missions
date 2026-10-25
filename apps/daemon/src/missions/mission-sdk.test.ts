import { writeFile } from "node:fs/promises";
import path from "node:path";
import { setImmediate as yieldImmediate } from "node:timers/promises";

import { ToolConfirmationOutcome } from "@factory/droid-sdk/node";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createDaemon } from "../daemon";
import type { Daemon } from "../daemon";
import type { AgentRuntimeOptions } from "../runtime/contracts";
import { AgentRuntime } from "../sdk/agent-runtime";
import { SUBMIT_ACK_TIMEOUT_MS } from "../sdk/submit-ack-timeout";
import { MockTransport } from "../test/droid-transport";
import { gitRepo, tempDir, testConfig } from "../test/fixtures";
import { PEER } from "../test/native-wire-peer";

const MODEL = { modelId: "initial-model", reasoningEffort: "medium" } as const;
const opened: Daemon[] = [];

const completion = (
  transport: MockTransport,
  reason = "completed",
  turnId = "turn"
) =>
  transport.notify({
    reason,
    tokenUsage: {
      cacheCreationTokens: 0,
      cacheReadTokens: 0,
      inputTokens: 0,
      outputTokens: 0,
      thinkingTokens: 0,
    },
    turnId,
    type: "agent_turn_completed",
  });

const boot = async (nativeWorker = false) => {
  const sessions: {
    runtime: AgentRuntime;
    transport: MockTransport;
    options: AgentRuntimeOptions;
  }[] = [];
  const config = await testConfig();
  const nativeDir = await tempDir("stall-native-peer");
  const executable = path.join(nativeDir, "peer.mjs");
  if (nativeWorker) {
    await writeFile(executable, PEER, { mode: 0o755 });
    config.droidPath = executable;
  }
  const daemon = await createDaemon({
    config,
    createRuntime: (options) => {
      const transport = new MockTransport();
      transport.initializeResult.sessionId = `session-${options.agentId}`;
      transport.initializeResult.settings = {
        modelId: MODEL.modelId,
        reasoningEffort: "medium",
      };
      const runtime = new AgentRuntime({
        ...options,
        ...(nativeWorker && options.role === "worker"
          ? {
              extraEnv: {
                WIRE_MESSAGE_RECORD: path.join(nativeDir, "messages"),
                WIRE_RECORD: path.join(nativeDir, "methods"),
                WIRE_SETTINGS_RECORD: path.join(nativeDir, "settings"),
              },
            }
          : { createTransport: () => transport }),
      });
      sessions.push({ options, runtime, transport });
      return runtime;
    },
    loadModels: () =>
      Promise.resolve([
        {
          defaultReasoningEffort: "medium",
          id: MODEL.modelId,
          supportedReasoningEfforts: ["medium"],
        },
      ]),
    version: "sdk-test",
  });
  opened.push(daemon);
  const added = await daemon.projects.addLocal({
    operationId: "sdk-project",
    path: await gitRepo("sdk-mission"),
  });
  if (added.status !== "added") {
    throw new Error("Project was not added");
  }
  const snapshot = await daemon.missions.create({
    goal: "Complete a bounded task",
    operationId: "sdk-mission",
    orchestrator: MODEL,
    projectId: added.project.id,
    worker: MODEL,
    workspace: { mode: "current_checkout" },
  });
  const missionId = snapshot.mission.id;
  await vi.waitFor(() =>
    expect(
      sessions[0]?.transport.requests.some(
        (request) => request.method === "droid.add_user_message"
      )
    ).toBeTruthy()
  );
  const [main] = sessions;
  if (!main) {
    throw new Error("No main session");
  }
  const dispatch = main.options.mcpServers?.[0]?.tools.find(
    (tool) => tool.name === "dispatch_worker"
  );
  if (!dispatch) {
    throw new Error("No dispatch tool");
  }
  await dispatch.handler({
    instructions: "Do the task",
    needsWrite: true,
    title: "Worker task",
  });
  await vi.waitFor(() =>
    expect(daemon.missions.snapshot(missionId).assignments[0]?.status).toBe(
      "running"
    )
  );
  await vi.waitFor(() => expect(sessions[1]).toBeDefined());
  const [, worker] = sessions;
  if (!worker) {
    throw new Error("No Worker session");
  }
  await vi.waitFor(() => expect(worker.runtime.queue.list()).toHaveLength(1));
  return { daemon, main, missionId, worker };
};

type Context = Awaited<ReturnType<typeof boot>>;
const notices = (ctx: Context) =>
  ctx.daemon.store.queue
    .list(ctx.missionId)
    .filter((item) => item.id.startsWith("evt:"));

const expectNotice = async (ctx: Context, kind: string) => {
  await vi.waitFor(() =>
    expect(
      notices(ctx).some((item) => item.id.startsWith(`evt:${kind}:`))
    ).toBeTruthy()
  );
  const notice = notices(ctx).find((item) =>
    item.id.startsWith(`evt:${kind}:`)
  );
  if (!notice) {
    throw new Error("Missing notice");
  }
  await vi.waitFor(() =>
    expect(ctx.main.runtime.queue.get(notice.id)?.state).toBe("queued")
  );
  return notice;
};

describe("mission lifecycle through the installed DroidClient", () => {
  afterEach(async () => {
    vi.useRealTimers();
    await Promise.all(opened.splice(0).map((daemon) => daemon.close()));
  });

  it("returns the actual Worker clone denial and acknowledged tool-correlated system context", async () => {
    const ctx = await boot();
    const command =
      "git clone https://example.invalid/dependency /outside/dependency";
    ctx.worker.transport.receive({
      id: "clone-permission",
      method: "droid.request_permission",
      params: {
        options: [
          { label: "Once", value: ToolConfirmationOutcome.ProceedOnce },
          { label: "Cancel", value: ToolConfirmationOutcome.Cancel },
        ],
        toolUses: [
          {
            confirmationType: "exec",
            details: {
              command,
              fullCommand: command,
              impactLevel: "high",
              type: "exec",
            },
            toolUse: {
              id: "clone-tool",
              input: { command },
              name: "Execute",
              type: "tool_use",
            },
          },
        ],
      },
      type: "request",
    });
    await vi.waitFor(() =>
      expect(ctx.worker.transport.sent).toContainEqual(
        expect.objectContaining({ id: "clone-permission", type: "response" })
      )
    );
    expect(
      ctx.worker.transport.sent.find(
        (wire) => wire.type === "response" && wire.id === "clone-permission"
      )
    ).toMatchObject({
      result: {
        comment: expect.stringContaining("obtain the dependency repository"),
        selectedOption: ToolConfirmationOutcome.Cancel,
      },
    });
    expect(
      ctx.worker.transport.requests.find(
        (request) => request.params.role === "system"
      )
    ).toMatchObject({
      params: {
        role: "system",
        skipAgentLoop: true,
        text: expect.stringContaining("Execute [clone-tool]"),
        visibility: "llm_only",
      },
    });
    completion(ctx.worker.transport);
    const notice = await expectNotice(ctx, "worker-stalled");
    expect(notice.text).toContain("obtain the dependency repository");
    expect(ctx.daemon.store.permissions.list(ctx.missionId)).toStrictEqual([]);
  });

  it("retains tool errors through a normal completed notification", async () => {
    const ctx = await boot();
    ctx.worker.transport.notify({
      toolUse: {
        id: "exec",
        input: { command: "false" },
        name: "Execute",
        type: "tool_use",
      },
      type: "tool_call",
    });
    ctx.worker.transport.notify({
      content: "exit status 1",
      isError: true,
      messageId: "result",
      toolUseId: "exec",
      type: "tool_result",
    });
    completion(ctx.worker.transport);
    const notice = await expectNotice(ctx, "worker-stalled");
    expect(notice.text).toContain("exit status 1");
  });

  it.each(["Error", "SessionError"] as const)(
    "classifies SDK %s followed by completed without duplicate notices",
    async (errorType) => {
      const ctx = await boot();
      ctx.worker.transport.notify({
        errorType,
        message: "SDK error detail",
        timestamp: new Date().toISOString(),
        type: "error",
      });
      completion(ctx.worker.transport);
      const kind =
        errorType === "SessionError" ? "worker-failed" : "worker-stalled";
      const notice = await expectNotice(ctx, kind);
      expect(notice.text).toContain("SDK error detail");
      expect(notices(ctx)).toHaveLength(1);
    }
  );

  it("marks completion error failed before cleanup and sends a failed notice", async () => {
    const ctx = await boot();
    completion(ctx.worker.transport, "error");
    const notice = await expectNotice(ctx, "worker-failed");
    expect(
      ctx.daemon.missions.snapshot(ctx.missionId).assignments[0]?.status
    ).toBe("failed");
    expect(notice.text).toContain("error");
  });

  it.each(["ack", "reject", "echo"] as const)(
    "attempts a failure behind a hung earlier ACK and reconciles late %s without replay",
    async (late) => {
      const ctx = await boot();
      ctx.main.transport.deferMethod = "droid.add_user_message";
      vi.useFakeTimers();
      await ctx.daemon.missions.submitMessage(ctx.missionId, {
        mode: "steer",
        operationId: "hung-sdk",
        text: "Earlier user message",
      });
      await vi.waitFor(() =>
        expect(
          ctx.main.transport.requests.some(
            (request) => request.id === "hung-sdk"
          )
        ).toBeTruthy()
      );
      ctx.main.transport.deferMethod = null;
      completion(ctx.worker.transport, "error");
      await vi.advanceTimersByTimeAsync(SUBMIT_ACK_TIMEOUT_MS);
      const [notice] = notices(ctx);
      expect(
        ctx.main.transport.requests.map((request) => request.id)
      ).toContain(notice?.id);
      expect([
        ctx.main.runtime.queue.get("hung-sdk")?.state,
        ctx.daemon.store.queue.get("hung-sdk")?.state,
      ]).toStrictEqual(["unknown", "unknown"]);
      const earlier = ctx.main.transport.requests.find(
        (request) => request.id === "hung-sdk"
      );
      if (!earlier) {
        throw new Error("Missing hung request");
      }
      if (late === "reject") {
        ctx.main.transport.receive({
          error: { code: -32_602, message: "late rejection" },
          id: earlier.id,
          type: "response",
        });
      } else {
        if (late === "echo") {
          ctx.main.transport.userMessage(
            "echo",
            "Earlier user message",
            earlier.id
          );
        }
        ctx.main.transport.respond(earlier);
      }
      await vi.advanceTimersByTimeAsync(0);
      const expected = { ack: "queued", echo: "sent", reject: "failed" }[late];
      expect([
        ctx.daemon.store.queue.get(earlier.id)?.state,
        ctx.main.runtime.queue.get(earlier.id)?.state,
      ]).toStrictEqual([expected, expected]);
      expect(
        ctx.main.transport.requests.filter(
          (request) => request.id === earlier.id
        )
      ).toHaveLength(1);
    }
  );

  it("preserves unknown delivery through Pause cleanup and ignores a late old-owner ACK", async () => {
    const ctx = await boot();
    ctx.main.transport.deferMethod = "droid.add_user_message";
    vi.useFakeTimers();
    await ctx.daemon.missions.submitMessage(ctx.missionId, {
      mode: "steer",
      operationId: "cleanup-hung",
      text: "Uncertain original",
    });
    await vi.waitFor(() =>
      expect(
        ctx.main.transport.requests.some(
          (request) => request.id === "cleanup-hung"
        )
      ).toBeTruthy()
    );
    await vi.advanceTimersByTimeAsync(SUBMIT_ACK_TIMEOUT_MS);
    const earlier = ctx.main.transport.requests.find(
      (request) => request.id === "cleanup-hung"
    );
    if (!earlier) {
      throw new Error("Missing earlier submit");
    }
    ctx.main.transport.deferMethod = "droid.resolve_queued_user_message";
    vi.useRealTimers();
    await ctx.daemon.missions.pause(ctx.missionId, {
      expectedRevision: ctx.daemon.missions.get(ctx.missionId).revision,
      operationId: "cleanup-pause",
    });
    const before = ctx.daemon.store.queue.get("cleanup-hung")?.state;
    ctx.main.transport.respond(earlier);
    await yieldImmediate();
    expect([
      before,
      ctx.daemon.store.queue.get("cleanup-hung")?.state,
    ]).toStrictEqual(["unknown", "unknown"]);
    expect(
      ctx.main.transport.requests.filter(
        (request) => request.id === "cleanup-hung"
      )
    ).toHaveLength(1);
  });

  it.each(["idle", "thinking"])(
    "retains notice delivery after actual OS-process exit while the main agent is %s",
    async (state) => {
      const ctx = await boot(true);
      ctx.main.transport.notify({
        newState: state,
        type: "droid_working_state_changed",
      });
      await ctx.worker.runtime
        .submit("exit-native-worker", "__exit_worker__", "steer")
        .catch(() => null);
      const notice = await expectNotice(ctx, "worker-failed");
      expect(notice.text).toContain("process exited");
      ctx.main.transport.userMessage(
        "failure-consumed",
        notice.text,
        notice.id
      );
      await vi.waitFor(() =>
        expect(ctx.daemon.store.queue.get(notice.id)?.state).toBe("sent")
      );
      await yieldImmediate();
      expect(notices(ctx)).toHaveLength(1);
    }
  );
});
