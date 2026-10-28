import type {
  Mission,
  PermissionRequest,
  QueueItem,
} from "@missions/protocol/missions";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ApiRequestError } from "../api/api-error";
import { OperationIntents } from "../api/operation-intents";
import type { LocalEntity } from "../live/mission-store";
import { missionCommandTransport } from "./command-transport";
import { CONTROL_BUSY, MissionCommands } from "./commands";
import type { MissionCommandTransport } from "./commands";

const AT = "2026-01-01T00:00:00.000Z";
const mission: Mission = {
  createdAt: AT,
  endedAt: null,
  epoch: 0,
  executionMode: "work",
  goal: "Test the mission",
  id: "m",
  lastError: null,
  orchestrator: { modelId: "model", reasoningEffort: null },
  projectId: "p",
  publish: {
    cleanup: "none",
    cleanupReason: null,
    commits: [],
    pr: null,
    pushedBranch: null,
    remote: null,
  },
  revision: 2,
  status: "running",
  summary: null,
  title: "Mission",
  updatedAt: AT,
  worker: { modelId: "model", reasoningEffort: null },
  workspace: null,
};
const queue: QueueItem = {
  agentId: "agent",
  attachments: [],
  createdAt: AT,
  error: null,
  id: "q",
  missionId: "m",
  mode: "steer",
  origin: "user",
  purpose: "message",
  replacedById: null,
  replacesId: null,
  retryOf: null,
  revision: 1,
  sender: null,
  sequence: 0,
  state: "queued",
  text: "hello",
  updatedAt: AT,
};
const permission: PermissionRequest = {
  agentId: null,
  allowAlways: false,
  createdAt: AT,
  decidedAt: AT,
  decision: "approve_once",
  epoch: 1,
  id: "permission",
  kind: "publish",
  missionId: "m",
  reason: null,
  status: "approved",
  toolUses: [],
};
const failure = (status: number) =>
  new ApiRequestError({
    code: "internal",
    message: "Failed",
    status,
  });
const missing = () => Promise.reject(new Error("Unexpected transport call"));
const fakeTransport = (
  overrides: Partial<MissionCommandTransport>
): MissionCommandTransport => ({
  archive: missing,
  cleanup: missing,
  commit: missing,
  delete: missing,
  editQueue: missing,
  message: missing,
  pause: missing,
  permission: missing,
  plan: missing,
  pullRequest: missing,
  push: missing,
  question: missing,
  queueMode: missing,
  removeQueue: missing,
  resume: missing,
  retryQueue: missing,
  rewind: missing,
  update: missing,
  ...overrides,
});
const intents = () => {
  let next = 0;
  return new OperationIntents(() => {
    next += 1;
    return `operation-${next}`;
  });
};

describe(MissionCommands, () => {
  afterEach(() => vi.unstubAllGlobals());

  it("shares synchronous control admission and pending state across callers", async () => {
    const pending = Promise.withResolvers<Mission>();
    const resume = vi
      .fn<MissionCommandTransport["resume"]>()
      .mockReturnValue(pending.promise);
    const commands = new MissionCommands(
      "m",
      fakeTransport({ resume }),
      intents()
    );
    const listener = vi.fn<() => void>();
    const unsubscribe = commands.subscribe(listener);
    const header = commands.run("resume", { expectedRevision: 1 });
    expect(commands.pendingControl()).toBe("resume");
    const banner = commands.run("resume", { expectedRevision: 1 });
    expect(banner).toBe(header);
    await Promise.resolve();
    expect(resume).toHaveBeenCalledOnce();
    pending.resolve(mission);
    await header;
    expect(commands.pendingControl()).toBeNull();
    expect(listener).toHaveBeenCalledTimes(2);
    unsubscribe();
  });

  it("rejects a different control instead of handing it the running one's result", async () => {
    const resuming = Promise.withResolvers<Mission>();
    const resume = vi
      .fn<MissionCommandTransport["resume"]>()
      .mockReturnValue(resuming.promise);
    const pause = vi.fn<MissionCommandTransport["pause"]>();
    const archive = vi.fn<MissionCommandTransport["archive"]>();
    const commands = new MissionCommands(
      "m",
      fakeTransport({ archive, pause, resume }),
      intents()
    );
    const resumed = commands.run("resume", { expectedRevision: 1 });
    await expect(
      commands.run("pause", { expectedRevision: 1 })
    ).rejects.toThrow(CONTROL_BUSY);
    await expect(
      commands.run("archive", { expectedRevision: 1 })
    ).rejects.toThrow(CONTROL_BUSY);
    resuming.resolve(mission);
    await expect(resumed).resolves.toBe(mission);
    expect([pause, archive].map((fn) => fn.mock.calls.length)).toStrictEqual([
      0, 0,
    ]);
  });

  it("never hands a Mission from another control to delete", async () => {
    const pausing = Promise.withResolvers<Mission>();
    const pause = vi
      .fn<MissionCommandTransport["pause"]>()
      .mockReturnValue(pausing.promise);
    const remove = vi.fn<MissionCommandTransport["delete"]>();
    const commands = new MissionCommands(
      "m",
      fakeTransport({ delete: remove, pause }),
      intents()
    );
    const paused = commands.run("pause", { expectedRevision: 1 });
    await expect(
      commands.run("delete", { expectedRevision: 1 })
    ).rejects.toThrow(CONTROL_BUSY);
    pausing.resolve(mission);
    await expect(paused).resolves.toBe(mission);
    expect(remove).not.toHaveBeenCalled();
  });

  it("never hands a delete acknowledgment to another control", async () => {
    const remove = vi
      .fn<MissionCommandTransport["delete"]>()
      .mockResolvedValue({ operationId: "operation-1", status: "accepted" });
    const commands = new MissionCommands(
      "m",
      fakeTransport({ delete: remove }),
      intents()
    );
    const deleting = commands.run("delete", { expectedRevision: 2 });
    expect(commands.pendingControl()).toBe("delete");
    await expect(
      commands.run("resume", { expectedRevision: 2 })
    ).rejects.toThrow(CONTROL_BUSY);
    await expect(deleting).resolves.toMatchObject({ status: "accepted" });
    expect(commands.pendingControl()).toBeNull();
  });

  it("captures complete payloads before transport and releases the control after failure", async () => {
    const resume = vi
      .fn<MissionCommandTransport["resume"]>()
      .mockRejectedValueOnce(failure(503))
      .mockResolvedValue(mission);
    const commands = new MissionCommands(
      "m",
      fakeTransport({ resume }),
      intents()
    );
    const input = { expectedRevision: 1 };
    const first = commands.run("resume", input);
    input.expectedRevision = 99;
    await expect(first).rejects.toMatchObject({ status: 503 });
    expect(commands.pendingControl()).toBeNull();
    await commands.run("resume", { expectedRevision: 1 });
    expect(resume.mock.calls).toStrictEqual([
      [{ expectedRevision: 1 }, "operation-1"],
      [{ expectedRevision: 1 }, "operation-1"],
    ]);
  });

  it("shares permission admission between transcript and Digest without conflating requests", async () => {
    const pending = Promise.withResolvers<PermissionRequest>();
    const decide = vi
      .fn<MissionCommandTransport["permission"]>()
      .mockReturnValue(pending.promise);
    const commands = new MissionCommands(
      "m",
      fakeTransport({ permission: decide }),
      intents()
    );
    const input = {
      decision: "approve_once" as const,
      epoch: 1,
      requestId: "permission",
    };
    const first = commands.run("permission", input);
    expect(commands.run("permission", { ...input, decision: "deny" })).toBe(
      first
    );
    const another = commands.run("permission", {
      ...input,
      requestId: "another",
    });
    await Promise.resolve();
    expect(decide).toHaveBeenCalledTimes(2);
    pending.resolve(permission);
    await Promise.all([first, another]);
  });

  it("shares each role's model/thinking admission across overview remounts and releases after failure", async () => {
    const pending = Promise.withResolvers<Mission>();
    const update = vi
      .fn<MissionCommandTransport["update"]>()
      .mockReturnValueOnce(pending.promise)
      .mockResolvedValue(mission);
    const commands = new MissionCommands(
      "m",
      fakeTransport({ update }),
      intents()
    );
    const listener = vi.fn<() => void>();
    commands.subscribe(listener);
    const input = {
      expectedRevision: 2,
      orchestrator: { modelId: "changed", reasoningEffort: "low" as const },
    };
    const first = commands.run("update", input);
    const duplicate = commands.run("update", {
      ...input,
      orchestrator: { ...input.orchestrator, reasoningEffort: "high" },
    });
    expect([
      commands.pendingModelUpdate("orchestrator"),
      commands.pendingModelUpdate("worker"),
      duplicate === first,
    ]).toStrictEqual([true, false, true]);
    input.expectedRevision = 99;
    pending.reject(failure(503));
    await expect(first).rejects.toMatchObject({ status: 503 });
    expect(commands.pendingModelUpdate("orchestrator")).toBeFalsy();
    await commands.run("update", {
      expectedRevision: 3,
      worker: mission.worker,
    });
    expect(update.mock.calls.map(([body]) => body)).toStrictEqual([
      {
        expectedRevision: 2,
        orchestrator: { modelId: "changed", reasoningEffort: "low" },
      },
      { expectedRevision: 3, worker: mission.worker },
    ]);
    expect(listener).toHaveBeenCalledTimes(4);
  });

  it("keeps an unknown concurrent message ID when another identical occurrence settles", async () => {
    const a = Promise.withResolvers<QueueItem>();
    const b = Promise.withResolvers<QueueItem>();
    const message = vi
      .fn<MissionCommandTransport["message"]>()
      .mockReturnValueOnce(a.promise)
      .mockReturnValueOnce(b.promise)
      .mockResolvedValue(queue);
    const commands = new MissionCommands(
      "m",
      fakeTransport({ message }),
      intents()
    );
    const input = { mode: "steer" as const, text: "hello" };
    const first = commands.run("message", input, "first");
    const second = commands.run("message", input, "second");
    a.reject(failure(503));
    b.resolve(queue);
    const [rejected] = await Promise.allSettled([first, second]);
    expect(rejected).toMatchObject({
      reason: { status: 503 },
      status: "rejected",
    });
    await commands.run("message", input, "first");
    expect(message.mock.calls.map((call) => call[1])).toStrictEqual([
      "operation-1",
      "operation-2",
      "operation-1",
    ]);
  });

  it("includes queue revision and every editable publishing field in intent identity", async () => {
    const commit = vi
      .fn<MissionCommandTransport["commit"]>()
      .mockRejectedValue(failure(503));
    const pullRequest = vi
      .fn<MissionCommandTransport["pullRequest"]>()
      .mockRejectedValue(failure(503));
    const cleanup = vi
      .fn<MissionCommandTransport["cleanup"]>()
      .mockRejectedValue(failure(503));
    const editQueue = vi
      .fn<MissionCommandTransport["editQueue"]>()
      .mockRejectedValue(failure(503));
    const commands = new MissionCommands(
      "m",
      fakeTransport({ cleanup, commit, editQueue, pullRequest }),
      intents()
    );
    const base = {
      expectedChangesHash: "hash",
      expectedHead: "head",
      includePreExisting: false,
      message: "first",
    };
    await Promise.all(
      [
        base,
        { ...base, message: "second" },
        { ...base, includePreExisting: true },
        { ...base, expectedHead: "moved" },
        { ...base, expectedChangesHash: "new" },
        base,
      ].map(async (input) => {
        await expect(commands.run("commit", input)).rejects.toMatchObject({
          status: 503,
        });
      })
    );
    expect(
      new Set(commit.mock.calls.slice(0, 5).map((call) => call[1])).size
    ).toBe(5);
    expect(commit.mock.calls[5]?.[1]).toBe(commit.mock.calls[0]?.[1]);
    const pr = { body: "body", expectedHead: "head", title: "title" };
    await Promise.all(
      [
        pr,
        { ...pr, title: "new" },
        { ...pr, body: "new" },
        { ...pr, expectedHead: "moved" },
      ].map(async (input) => {
        await expect(commands.run("pullRequest", input)).rejects.toMatchObject({
          status: 503,
        });
      })
    );
    expect(new Set(pullRequest.mock.calls.map((call) => call[1])).size).toBe(4);
    await Promise.all(
      [false, true].map(async (alwaysAfterMerge) => {
        await expect(
          commands.run("cleanup", { action: "remove", alwaysAfterMerge })
        ).rejects.toMatchObject({ status: 503 });
      })
    );
    expect(cleanup.mock.calls[0]?.[1]).not.toBe(cleanup.mock.calls[1]?.[1]);
    await Promise.all(
      [1, 2].map(async (expectedRevision) => {
        await expect(
          commands.run("editQueue", {
            expectedRevision,
            itemId: "q",
            text: "edit",
          })
        ).rejects.toMatchObject({ status: 503 });
      })
    );
    expect(editQueue.mock.calls[0]?.[1]).not.toBe(editQueue.mock.calls[1]?.[1]);
  });

  it("uses the production HTTP adapter for unknown/rejected/retried effects and local reconciliation", async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(new Response("unavailable", { status: 503 }))
      .mockResolvedValueOnce(Response.json({ unexpected: true }))
      .mockResolvedValueOnce(new Response("stale", { status: 409 }))
      .mockResolvedValueOnce(Response.json(mission));
    vi.stubGlobal("fetch", fetch);
    const apply = vi.fn<(entity: LocalEntity) => void>();
    const commands = new MissionCommands(
      "m",
      missionCommandTransport("m", apply, () => Promise.resolve(true)),
      intents()
    );
    const input = { expectedRevision: 1 };
    await expect(commands.run("resume", input)).rejects.toMatchObject({
      status: 503,
    });
    await expect(commands.run("resume", input)).rejects.toMatchObject({
      status: 200,
    });
    await expect(commands.run("resume", input)).rejects.toMatchObject({
      status: 409,
    });
    await commands.run("resume", input);
    const sentIds = fetch.mock.calls.map(
      ([, init]) =>
        (
          JSON.parse(String((init as RequestInit).body)) as {
            operationId: string;
          }
        ).operationId
    );
    expect(sentIds).toStrictEqual([
      "operation-1",
      "operation-1",
      "operation-1",
      "operation-2",
    ]);
    expect(apply).toHaveBeenCalledExactlyOnceWith({
      kind: "mission",
      value: mission,
    });
  });

  it("reconciles returned queue/gate entities and refreshes edit outcomes through the production adapter", async () => {
    const plan = {
      createdAt: AT,
      decidedAt: AT,
      feedback: null,
      id: "plan",
      markdown: "",
      missionId: "m",
      revision: 1,
      status: "approved",
      title: "Plan",
    };
    const question = {
      agentId: "agent",
      answers: [],
      createdAt: AT,
      epoch: 1,
      id: "question",
      missionId: "m",
      questions: [],
      status: "answered",
    };
    const fetch = vi.fn<typeof globalThis.fetch>();
    for (const value of [
      queue,
      permission,
      plan,
      question,
      { outcome: "replaced", replacementId: "replacement" },
    ]) {
      fetch.mockResolvedValueOnce(Response.json(value));
    }
    vi.stubGlobal("fetch", fetch);
    const apply = vi.fn<(entity: LocalEntity) => void>();
    const refresh = vi.fn<() => Promise<boolean>>().mockResolvedValue(true);
    const commands = new MissionCommands(
      "m",
      missionCommandTransport("m", apply, refresh),
      intents()
    );
    await commands.run("message", { mode: "steer", text: "hello" }, "first");
    await commands.run("permission", {
      decision: "approve_once",
      epoch: 1,
      requestId: "permission",
    });
    await commands.run("plan", { approve: true, planRevision: 1 });
    await commands.run("question", {
      answers: [],
      cancelled: false,
      epoch: 1,
      questionId: "question",
    });
    await commands.run("editQueue", {
      expectedRevision: 1,
      itemId: "q",
      text: "edit",
    });
    expect(apply.mock.calls.map(([entity]) => entity.kind)).toStrictEqual([
      "queue",
      "permission",
      "plan",
      "question",
    ]);
    expect(refresh).toHaveBeenCalledOnce();
    const permissionBody = JSON.parse(String(fetch.mock.calls[1]?.[1]?.body));
    expect(permissionBody).toStrictEqual({
      decision: "approve_once",
      epoch: 1,
    });
  });
});
