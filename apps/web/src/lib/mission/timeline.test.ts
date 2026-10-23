import type {
  PermissionRequest,
  PlanRevision,
  TranscriptItem,
} from "@missions/protocol/missions";
import { describe, expect, it } from "vitest";

import { buildTimeline } from "./timeline";

const at = (second: number) =>
  `2025-01-01T00:00:${String(second).padStart(2, "0")}.000Z`;

const item = (
  seq: number,
  kind: TranscriptItem["kind"],
  extra: Partial<TranscriptItem> = {}
): TranscriptItem => ({
  agentId: "orch",
  createdAt: at(seq),
  id: `t${seq}`,
  isError: false,
  kind,
  missionId: "m1",
  requestId: null,
  seq,
  text: `text ${seq}`,
  toolName: null,
  toolUseId: null,
  ...extra,
});

const plan = (revision: number, second: number): PlanRevision => ({
  createdAt: at(second),
  decidedAt: null,
  feedback: null,
  id: `p${revision}`,
  markdown: "# Plan",
  missionId: "m1",
  revision,
  status: revision === 2 ? "proposed" : "superseded",
  title: "Plan",
});

const permission = (second: number): PermissionRequest => ({
  agentId: "orch",
  allowAlways: true,
  createdAt: at(second),
  decidedAt: null,
  decision: null,
  epoch: 0,
  id: "r1",
  kind: "tool",
  missionId: "m1",
  reason: null,
  status: "pending",
  toolUses: [],
});

const empty = { permissions: [], plans: [], previews: [], questions: [] };

describe(buildTimeline, () => {
  it("groups consecutive tool calls and pairs results by toolUseId", () => {
    const timeline = buildTimeline({
      ...empty,
      transcript: [
        item(4, "tool_result", { toolUseId: "a" }),
        item(1, "user"),
        item(2, "tool_call", { toolName: "Read", toolUseId: "a" }),
        item(3, "tool_call", { toolName: "Grep", toolUseId: "b" }),
        item(5, "assistant"),
        item(6, "tool_result", { toolUseId: "b" }),
      ],
    });
    expect(timeline.map((entry) => entry.kind)).toStrictEqual([
      "user",
      "tools",
      "assistant",
    ]);
    const [, group] = timeline;
    expect(
      group?.kind === "tools"
        ? group.calls.map((call) => call.result?.id)
        : null
    ).toStrictEqual(["t4", "t6"]);
  });

  it("starts a new tool group when the agent changes", () => {
    const timeline = buildTimeline({
      ...empty,
      transcript: [
        item(1, "tool_call", { toolUseId: "a" }),
        item(2, "tool_call", { agentId: "w1", toolUseId: "b" }),
      ],
    });
    expect(timeline.map((entry) => entry.agentId)).toStrictEqual([
      "orch",
      "w1",
    ]);
  });

  it("slots decision cards by time and flags the latest plan", () => {
    const timeline = buildTimeline({
      ...empty,
      permissions: [permission(9)],
      plans: [plan(2, 4), plan(1, 2)],
      transcript: [item(1, "user"), item(3, "assistant"), item(5, "assistant")],
    });
    expect(timeline.map((entry) => entry.id)).toStrictEqual([
      "t1",
      "plan:p1",
      "t3",
      "plan:p2",
      "t5",
      "permission:r1",
    ]);
    const latest = timeline.filter(
      (entry) => entry.kind === "plan" && entry.latest
    );
    expect(latest.map((entry) => entry.id)).toStrictEqual(["plan:p2"]);
  });

  it("hides role tool calls and their results, and splits groups by category", () => {
    const timeline = buildTimeline({
      ...empty,
      transcript: [
        item(1, "tool_call", { toolName: "Read", toolUseId: "a" }),
        item(2, "tool_call", { toolName: "Grep", toolUseId: "b" }),
        item(3, "tool_call", {
          toolName: "missions.update_todos",
          toolUseId: "c",
        }),
        item(4, "tool_result", { toolUseId: "c" }),
        item(5, "tool_call", { toolName: "Execute", toolUseId: "d" }),
      ],
    });
    expect(
      timeline.map((entry) =>
        entry.kind === "tools"
          ? entry.calls.map((call) => call.call?.toolName)
          : entry.kind
      )
    ).toStrictEqual([["Read", "Grep"], ["Execute"]]);
  });

  it("adds a plan approved line at the decision time and slots assignments", () => {
    const approved: PlanRevision = {
      ...plan(1, 2),
      decidedAt: at(4),
      status: "approved",
    };
    const timeline = buildTimeline({
      ...empty,
      assignments: [
        {
          createdAt: at(6),
          epoch: 0,
          handoff: null,
          id: "as1",
          instructions: "",
          missionId: "m1",
          needsWrite: true,
          status: "running",
          title: "Add Clock interface",
          updatedAt: at(6),
          workerAgentId: "w1",
        },
      ],
      plans: [approved],
      transcript: [item(1, "user"), item(5, "assistant")],
    });
    expect(timeline.map((entry) => entry.id)).toStrictEqual([
      "t1",
      "plan:p1",
      "approved:p1",
      "t5",
      "assignment:as1",
    ]);
  });

  it("appends streaming previews in delta order with joined text", () => {
    const timeline = buildTimeline({
      ...empty,
      previews: [
        { agentId: "w1", chunks: { 9: "late" }, kind: "text", messageId: "b" },
        {
          agentId: "orch",
          chunks: { 6: "hello", 7: " world" },
          kind: "text",
          messageId: "a",
        },
      ],
      transcript: [item(1, "user")],
    });
    expect(
      timeline.map((entry) =>
        entry.kind === "preview" ? entry.text : entry.kind
      )
    ).toStrictEqual(["user", "hello world", "late"]);
  });
});
