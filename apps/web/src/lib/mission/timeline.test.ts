import type {
  MessageParty,
  PermissionRequest,
  PlanRevision,
  TranscriptItem,
} from "@missions/protocol/missions";
import { describe, expect, it } from "vitest";

import { buildTimeline, transcriptRows } from "./timeline";
import type { TimelineEntry, ToolCall } from "./timeline";
import { argumentOf, inputOf, toolCardKind, toolSummary } from "./tool-output";

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
  purpose: null,
  recipient: null,
  requestId: null,
  sender: null,
  seq,
  text: `text ${seq}`,
  toolName: null,
  toolUseId: null,
  ...extra,
});

const plan = (revision: number, second: number): PlanRevision => ({
  actionable: false,
  agentId: null,
  createdAt: at(second),
  decidedAt: null,
  epoch: null,
  feedback: null,
  guidanceVersion: null,
  id: `p${revision}`,
  markdown: "# Plan",
  missionId: "m1",
  revision,
  sessionId: null,
  status: revision === 2 ? "proposed" : "superseded",
  title: "Plan",
  toolUseId: null,
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

const tool = (
  name: string,
  seq: number,
  extra: Partial<TranscriptItem> = {}
): ToolCall => ({
  call: item(seq, "tool_call", { toolName: name, ...extra }),
  id: `tool-${seq}`,
  result: null,
});
const tools = (call: ToolCall, agentId = "orch"): TimelineEntry => ({
  agentId,
  calls: [call],
  id: call.id,
  kind: "tools",
});

describe("Transcript presentation", () => {
  it("waits for narration to finish, then keeps the plan after all explanation messages", () => {
    const input = {
      ...empty,
      planAgentId: "orch",
      planInFlight: true,
      plans: [plan(2, 2)],
      transcript: [
        item(1, "assistant"),
        item(3, "assistant"),
        item(4, "assistant"),
      ],
    };
    expect(buildTimeline(input).map((entry) => entry.kind)).toStrictEqual([
      "assistant",
      "assistant",
      "assistant",
    ]);
    expect(
      buildTimeline({ ...input, planInFlight: false }).map(
        (entry) => entry.kind
      )
    ).toStrictEqual(["assistant", "assistant", "assistant", "plan"]);
    expect(
      buildTimeline({ ...input, planInFlight: false }).flatMap((entry) =>
        entry.kind === "assistant" ? [entry.item.text] : []
      )
    ).toStrictEqual(["text 1", "text 3", "text 4"]);
  });

  it("keeps decided plans in place when later turns arrive", () => {
    const input = {
      ...empty,
      planAgentId: "orch",
      plans: [{ ...plan(2, 2), decidedAt: at(5), status: "approved" as const }],
      transcript: [
        item(1, "assistant"),
        item(3, "assistant"),
        item(6, "assistant"),
      ],
    };
    expect(buildTimeline(input).map((entry) => entry.kind)).toStrictEqual([
      "assistant",
      "assistant",
      "plan",
      "plan_approved",
      "assistant",
    ]);
  });

  it("parses tool arguments defensively and classifies command/edit presentations without React", () => {
    const read = tool("Read", 1, {
      toolInput: { file_path: "/repo/src/a.ts" },
    });
    const grep = tool("Grep", 2, {
      toolInput: { path: "/repo/src", pattern: "needle" },
    });
    expect(argumentOf(read, "/repo")).toBe("src/a.ts");
    expect(argumentOf(grep, "/repo")).toBe('"needle" in src');
    expect(
      inputOf(tool("Read", 3, { toolInput: ["not", "an", "object"] }))
    ).toStrictEqual({});
    expect(toolSummary([read, read, grep])).toBe("Read 2 files, ran 1 search");
  });

  it("classifies command and edit presentation without React", () => {
    const execute = tool("Execute", 4, { toolInput: { command: "pnpm test" } });
    expect(toolCardKind([execute], true)).toBe("command");
    expect(toolCardKind([execute], false)).toBeNull();
    const successful = { ...execute, result: item(5, "tool_result") };
    expect(toolCardKind([successful], false)).toBe("ran");
    expect(
      toolCardKind(
        [{ ...successful, result: item(5, "tool_result", { isError: true }) }],
        false
      )
    ).toBe("command");
    expect(
      toolCardKind(
        [tool("Edit", 6, { toolInput: { new_str: "new", old_str: "old" } })],
        false
      )
    ).toBe("edit");
  });

  it("folds exploration by agent, breaks out command cards and preserves the live-tail loader", () => {
    const entries = [
      tools(tool("Read", 1)),
      tools(tool("Grep", 2)),
      tools(tool("Execute", 3)),
      tools(tool("Read", 4)),
    ];
    const rows = transcriptRows(entries, true);
    expect(rows.map((row) => row.kind)).toStrictEqual([
      "tools",
      "card",
      "tools",
    ]);
    expect(rows[0]).toMatchObject({ tail: false });
    expect(rows[2]).toMatchObject({ tail: true });
    expect(rows[0]?.kind === "tools" ? rows[0].groups.length : 0).toBe(2);
    expect(entries[0]?.kind === "tools" ? entries[0].calls.length : 0).toBe(1);
  });

  it("hides worker narration/tools but never worker permission and question gates", () => {
    const request = { ...permission(1), agentId: "worker" };
    const gate: TimelineEntry = {
      agentId: "worker",
      id: "gate",
      kind: "permission",
      request,
    };
    const narration: TimelineEntry = {
      agentId: "worker",
      id: "text",
      item: item(3, "assistant"),
      kind: "assistant",
    };
    const rows = transcriptRows(
      [tools(tool("Read", 1), "worker"), narration, gate],
      true,
      { worker: { role: "worker" } }
    );
    expect(rows).toStrictEqual([{ entry: gate, id: "gate", kind: "entry" }]);
  });
});

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

const orch: MessageParty = {
  agentId: "orch",
  role: "orchestrator",
  title: "Orchestrator",
};
const w1: MessageParty = { agentId: "w1", role: "worker", title: "Worker" };
const w2: MessageParty = { agentId: "w2", role: "worker", title: "Worker 2" };
const message = (seq: number, sender: MessageParty, recipient: MessageParty) =>
  item(seq, "agent_message", {
    agentId: sender.agentId,
    purpose: "message",
    recipient,
    requestId: `q${seq}`,
    sender,
  });

describe("agent messages", () => {
  it("groups an exchange between one pair until another row intervenes", () => {
    const timeline = buildTimeline({
      ...empty,
      transcript: [
        message(1, orch, w1),
        message(2, w1, orch),
        message(3, orch, w1),
        message(4, orch, w2),
        item(5, "user"),
        message(6, w2, orch),
      ],
    });
    const rows = transcriptRows(timeline, true);
    expect(
      rows.map((row) =>
        row.kind === "messages" ? row.items.map((entry) => entry.id) : row.kind
      )
    ).toStrictEqual([["t1", "t2", "t3"], ["t4"], "entry", ["t6"]]);
  });

  it("hides send_message and native plan calls, but shows a failed role call", () => {
    const timeline = buildTimeline({
      ...empty,
      transcript: [
        item(1, "tool_call", {
          toolName: "missions.send_message",
          toolUseId: "a",
        }),
        item(2, "tool_result", { toolUseId: "a" }),
        message(3, orch, w1),
        item(4, "tool_call", { toolName: "ExitSpecMode", toolUseId: "b" }),
        item(5, "tool_call", {
          toolName: "missions.send_message",
          toolUseId: "c",
        }),
        item(6, "tool_result", { isError: true, toolUseId: "c" }),
      ],
    });
    expect(
      timeline.map((entry) =>
        entry.kind === "tools"
          ? entry.calls.map((call) => [call.call?.id, call.result?.id])
          : entry.kind
      )
    ).toStrictEqual(["agent_message", [["t5", "t6"]]]);
  });

  it("shows a live native plan while the agent is still mid-turn", () => {
    const timeline = buildTimeline({
      ...empty,
      planAgentId: "orch",
      planInFlight: true,
      plans: [{ ...plan(2, 2), actionable: true }],
      transcript: [item(1, "assistant")],
    });
    expect(timeline.map((entry) => entry.kind)).toStrictEqual([
      "assistant",
      "plan",
    ]);
  });
});
