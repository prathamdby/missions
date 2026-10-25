import type { Artifact, Assignment, Todo } from "@missions/protocol/missions";
import { describe, expect, it } from "vitest";

import { mission } from "../live/test-adapters";
import { buildDigest } from "./digest";
import type { DigestInput } from "./digest";

const AT = "2026-01-01T00:00:00.000Z";
const LATER = "2026-01-01T00:01:00.000Z";

const input = (extra: Partial<DigestInput> = {}): DigestInput => ({
  agents: {},
  artifacts: {},
  assignments: {},
  labels: { w1: "Ada" },
  mission: mission(),
  permissions: {},
  plans: {},
  questions: {},
  todos: {},
  ...extra,
});

const assignment = (status: Assignment["status"], id: string): Assignment => ({
  createdAt: AT,
  epoch: 0,
  handoff: null,
  id,
  instructions: "",
  missionId: "m-1",
  needsWrite: false,
  status,
  title: "Write notes",
  updatedAt: status === "handed_off" ? AT : LATER,
  workerAgentId: "w1",
});

const notes: Artifact = {
  agentId: "w1",
  createdAt: LATER,
  id: "file-1",
  kind: "file",
  mediaType: "text/plain",
  missionId: "m-1",
  name: "notes.md",
  size: 12,
};

const todo: Todo = {
  agentId: "w1",
  content: "Ship the notes",
  id: "todo-1",
  missionId: "m-1",
  position: 0,
  priority: "medium",
  status: "in_progress",
};

describe(buildDigest, () => {
  it("attributes handed-off work, artifacts, running assignments, and todos to the worker", () => {
    expect(
      buildDigest(
        input({
          artifacts: { file: notes },
          assignments: { done: assignment("handed_off", "as-done") },
        })
      ).recent
    ).toMatchObject([
      {
        agentId: "w1",
        detail: "Ada",
        id: "artifact:file-1",
        title: "Added notes.md",
      },
      {
        agentId: "w1",
        detail: "Ada",
        id: "assignment:as-done",
        title: "Write notes",
      },
    ]);
    expect(
      buildDigest(
        input({
          assignments: { live: assignment("running", "as-live") },
        })
      ).inProgress
    ).toMatchObject([{ agentId: "w1", detail: "Ada", title: "Write notes" }]);
    expect(
      buildDigest(input({ todos: { w1: [todo] } })).inProgress
    ).toMatchObject([
      { agentId: "w1", detail: "Ada", title: "Ship the notes" },
    ]);
  });
});
