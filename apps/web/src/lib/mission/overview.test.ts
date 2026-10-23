import type { Agent, Assignment, Todo } from "@missions/protocol/missions";
import { describe, expect, it } from "vitest";

import { MISSION_TODOS } from "../live/mission-state";
import { fileAuthors } from "./changes";
import { agentRows, groupTodos, todoProgress } from "./overview";

const AT = "2026-01-01T00:00:00.000Z";
const LATER = "2026-01-01T00:01:00.000Z";

const agent = (
  id: string,
  role: Agent["role"],
  extra: Partial<Agent> = {}
): Agent => ({
  assignmentId: null,
  createdAt: id === "orch" ? AT : LATER,
  holdsWriteLease: false,
  id,
  missionId: "m",
  model: { modelId: "scripted", reasoningEffort: null },
  previousSessionIds: [],
  promptVersion: null,
  role,
  sessionGeneration: 0,
  sessionId: null,
  status: "idle",
  title: role === "orchestrator" ? "Orchestrator" : "Worker 1",
  updatedAt: LATER,
  waitingReason: null,
  workingState: null,
  ...extra,
});

const todo = (
  agentId: string | null,
  position: number,
  status: Todo["status"]
): Todo => ({
  agentId,
  content: `todo ${position}`,
  id: `${agentId ?? "m"}:${position}`,
  missionId: "m",
  position,
  priority: "medium",
  status,
});

const assignment = (status: Assignment["status"]): Assignment => ({
  createdAt: AT,
  epoch: 0,
  handoff: null,
  id: "as1",
  instructions: "",
  missionId: "m",
  needsWrite: true,
  status,
  title: "Write NOTES.md",
  updatedAt: LATER,
  workerAgentId: "w1",
});

const agents = {
  orch: agent("orch", "orchestrator"),
  w1: agent("w1", "worker", {
    assignmentId: "as1",
    status: "stopped",
    workingState: "working",
  }),
};

describe("Todo presentation", () => {
  it("uses the same todo counts and fallback for every mission surface", () => {
    const workers = {
      w1: [todo("w1", 1, "pending"), todo("w1", 0, "completed")],
    };
    const fallback = todoProgress(workers, agents);
    expect(fallback).toMatchObject({ done: 1, total: 2 });
    expect(fallback.items.map((entry) => entry.position)).toStrictEqual([0, 1]);
    const main = todoProgress(
      {
        ...workers,
        [MISSION_TODOS]: [todo(null, 0, "completed")],
        orch: [todo("orch", 0, "pending")],
      },
      agents
    );
    expect(main).toMatchObject({ done: 1, total: 1 });
    expect(main.items[0]?.agentId).toBeNull();
    expect(todoProgress({}, agents)).toMatchObject({
      done: 0,
      items: [],
      total: 0,
    });
  });

  it("indexes all file authors once with the newest handoff winning independent of record order", () => {
    const older = {
      ...assignment("handed_off"),
      handoff: {
        checks: [],
        filesChanged: ["shared", "old"],
        followUps: [],
        summary: "",
      },
      updatedAt: AT,
      workerAgentId: "old",
    };
    const newer = {
      ...older,
      handoff: { ...older.handoff, filesChanged: ["shared", "new"] },
      updatedAt: LATER,
      workerAgentId: "new",
    };
    expect(
      fileAuthors({ newer, older }, { new: "Worker 2", old: "Worker 1" })
    ).toStrictEqual({
      new: "Worker 2",
      old: "Worker 1",
      shared: "Worker 2",
    });
  });
});

describe(groupTodos, () => {
  it("uses the Orchestrator's list as the mission todos and keeps worker lists apart", () => {
    const groups = groupTodos(
      {
        orch: [todo("orch", 1, "completed"), todo("orch", 0, "completed")],
        w1: [todo("w1", 0, "in_progress")],
      },
      agents
    );
    expect(groups.main.map((entry) => entry.id)).toStrictEqual([
      "orch:0",
      "orch:1",
    ]);
    expect(groups.workers).toStrictEqual([
      { agentId: "w1", todos: [todo("w1", 0, "in_progress")] },
    ]);
  });

  it("prefers mission-wide todos when the daemon sends them", () => {
    const groups = groupTodos(
      {
        [MISSION_TODOS]: [todo(null, 0, "pending")],
        orch: [todo("orch", 0, "pending")],
      },
      agents
    );
    expect(groups.main.map((entry) => entry.id)).toStrictEqual(["m:0"]);
    expect(groups.workers).toStrictEqual([]);
  });
});

const APPROVED = {
  awaitingApproval: false,
  environmentBlocked: false,
  planApprovedAt: AT,
  planning: false,
};

describe(agentRows, () => {
  it("names workers by assignment and ignores a stale workingState", () => {
    const [worker, orch] = agentRows(
      agents,
      { as1: assignment("handed_off") },
      { orch: [todo("orch", 0, "in_progress")] },
      { orch: "Orchestrator", w1: "Worker 1" },
      APPROVED
    );
    expect(orch?.activity).toBe("Explore and plan");
    expect(worker?.activity).toBe("Write NOTES.md");
    expect(worker?.phase).toBe("done");
    expect(worker?.endedAt).toBe(LATER);
  });

  it("reports live agents as working with no end time", () => {
    const [orch] = agentRows(
      { orch: agent("orch", "orchestrator", { status: "working" }) },
      {},
      {},
      {},
      APPROVED
    );
    expect(orch?.phase).toBe("working");
    expect(orch?.endedAt).toBeNull();
    expect(orch?.activity).toBe("Plans and reviews");
  });

  it("shows the Orchestrator exploring, then waiting on the plan", () => {
    const exploring = agentRows(
      { orch: agent("orch", "orchestrator", { status: "working" }) },
      {},
      {},
      {},
      { ...APPROVED, planApprovedAt: null, planning: true }
    );
    expect(exploring[0]?.activity).toBe("Explore and plan");
    expect(exploring[0]?.phase).toBe("working");
    const [waiting] = agentRows(
      { orch: agent("orch", "orchestrator") },
      {},
      {},
      {},
      { ...APPROVED, awaitingApproval: true, planApprovedAt: null }
    );
    expect(waiting?.phase).toBe("needs_you");
  });

  it("has no planning phase in Work mode without a plan", () => {
    const [orch] = agentRows(
      {
        orch: agent("orch", "orchestrator", {
          status: "starting",
          waitingReason: "write_lease",
        }),
      },
      {},
      {},
      {},
      { ...APPROVED, planApprovedAt: null }
    );
    expect(orch?.activity).toBe("Plans and reviews");
    expect(orch?.waiting).toBe("write_lease");
  });

  it("records the finished planning phase once the plan is approved", () => {
    const [orch] = agentRows(
      { orch: agent("orch", "orchestrator") },
      {},
      {},
      {},
      { ...APPROVED, planApprovedAt: LATER }
    );
    expect(orch?.activity).toBe("Explore and plan");
    expect(orch?.phase).toBe("done");
    expect(orch?.endedAt).toBe(LATER);
  });

  it("marks an idle worker with an open assignment as blocked by the environment", () => {
    const [worker] = agentRows(
      { ...agents, w1: agent("w1", "worker", { assignmentId: "as1" }) },
      { as1: assignment("running") },
      {},
      {},
      { ...APPROVED, environmentBlocked: true }
    );
    expect(worker?.phase).toBe("blocked");
  });
});
