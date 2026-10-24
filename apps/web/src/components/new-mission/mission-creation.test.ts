import type { CreateMissionRequest } from "@missions/protocol/commands";
import type { MissionSnapshot } from "@missions/protocol/missions";
import { describe, expect, it } from "vitest";

import { ApiRequestError } from "../../lib/api/api-error";
import { OperationIntents } from "../../lib/api/operation-intents";
import { MissionCreation } from "./mission-creation";
import type { MissionDraft } from "./mission-draft";

const draft = (): MissionDraft => ({
  goal: "Ship this outcome",
  orchestrator: { modelId: "planner", reasoningEffort: "high" },
  projectId: "project",
  worker: { modelId: "builder", reasoningEffort: null },
  workspace: { baseBranch: "main", mode: "new_worktree" },
});

const snapshot = (id: string): MissionSnapshot => ({
  agents: [],
  artifacts: [],
  assignments: [],
  cursor: 0,
  mission: {
    ...draft(),
    createdAt: "2026-01-01T00:00:00Z",
    endedAt: null,
    epoch: 0,
    executionMode: "work",
    id,
    lastError: null,
    orchestrator: { modelId: "planner", reasoningEffort: "high" },
    publish: {
      cleanup: "none",
      cleanupReason: null,
      commits: [],
      pr: null,
      pushedBranch: null,
      remote: null,
    },
    revision: 1,
    status: "exploring",
    summary: null,
    title: "Ship this outcome",
    updatedAt: "2026-01-01T00:00:00Z",
    worker: { modelId: "builder", reasoningEffort: null },
    workspace: null,
  },
  permissions: [],
  plans: [],
  questions: [],
  queue: [],
  todos: [],
  transcript: [],
  transcriptHasMore: false,
});

class FakeMissionDaemon {
  readonly requests: {
    request: CreateMissionRequest;
    result: ReturnType<typeof Promise.withResolvers<MissionSnapshot>>;
  }[] = [];
  readonly created = new Map<string, MissionSnapshot>();

  create = (request: CreateMissionRequest) => {
    const result = Promise.withResolvers<MissionSnapshot>();
    this.requests.push({ request, result });
    return result.promise;
  };

  commit(index: number, loseResponse = false) {
    const pending = this.requests[index];
    if (!pending) {
      throw new Error("No admitted request");
    }
    const { operationId } = pending.request;
    const value = this.created.get(operationId) ?? snapshot(operationId);
    this.created.set(operationId, value);
    if (loseResponse) {
      pending.result.reject(new Error("response lost after commit"));
    } else {
      pending.result.resolve(value);
    }
  }
}

const setup = () => {
  const remote = new FakeMissionDaemon();
  let sequence = 0;
  const intents = new OperationIntents(() => {
    sequence += 1;
    return `operation-${sequence}`;
  });
  const creation = new MissionCreation({ create: remote.create, intents });
  return { creation, remote };
};

describe("mission creation retries", () => {
  it("reconciles a committed but lost response rather than creating a second mission", async () => {
    const { creation, remote } = setup();
    const first = creation.submit(draft());
    remote.commit(0, true);
    await expect(first).rejects.toThrow("response lost");
    const retry = creation.submit(draft());
    remote.commit(1);
    const value = await retry;
    expect(remote.created.size).toBe(1);
    expect(remote.requests[1]?.request.operationId).toBe(
      remote.requests[0]?.request.operationId
    );
    expect(value.mission.id).toBe(remote.requests[0]?.request.operationId);
  });

  it("releases definite rejection and settled success so subsequent identical intent is new", async () => {
    const { creation, remote } = setup();
    const first = creation.submit(draft());
    remote.requests[0]?.result.reject(
      new ApiRequestError({ code: "conflict", message: "busy", status: 409 })
    );
    await expect(first).rejects.toThrow("busy");
    const retry = creation.submit(draft());
    remote.commit(1);
    await retry;
    const later = creation.submit(draft());
    remote.commit(2);
    await later;
    expect(
      remote.requests.map((entry) => entry.request.operationId)
    ).toStrictEqual(["operation-1", "operation-2", "operation-3"]);
  });

  it("settles exact concurrent keys and snapshots nested models before the draft can change", async () => {
    const { creation, remote } = setup();
    const value = draft();
    const first = creation.submit(value);
    value.orchestrator = { modelId: "changed", reasoningEffort: null };
    const other = creation.submit(value);
    remote.commit(1);
    await other;
    remote.commit(0, true);
    await expect(first).rejects.toThrow("response lost");
    const retry = creation.submit(draft());
    expect(remote.requests[0]?.request.orchestrator).toStrictEqual({
      modelId: "planner",
      reasoningEffort: "high",
    });
    expect(remote.requests[2]?.request.operationId).toBe(
      remote.requests[0]?.request.operationId
    );
    remote.commit(2);
    await retry;
    expect(remote.created.size).toBe(2);
  });
});
