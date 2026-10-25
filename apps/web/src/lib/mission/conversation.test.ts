import { AgentSchema } from "@missions/protocol/missions";
import { describe, expect, it } from "vitest";

import { isMissionActive } from "../format";
import { fromSnapshot } from "../live/mission-state";
import type { MissionLiveState } from "../live/mission-state";
import {
  AT,
  permission,
  plan,
  question,
  queueItem,
  snapshot,
  transcriptItem,
} from "../live/test-adapters";
import {
  conversationEntries,
  conversationParts,
  conversationTranscript,
} from "./conversation";
import { deliveredRequestIds, showGoalBubble } from "./queue";

// The original tuple and memo-stage order, now using the production stages.
const project = (live: MissionLiveState, agentId?: string) => {
  const missionId = live.mission.id;
  const worker = agentId ? live.agents[agentId]?.role === "worker" : false;
  const transcript = conversationTranscript(live.transcript, agentId);
  const entries = conversationEntries(live, transcript, agentId, worker);
  const goalBubble =
    !worker &&
    showGoalBubble(
      missionId,
      deliveredRequestIds(transcript),
      live.transcriptHasMore
    );
  const currentAgentId =
    agentId ??
    Object.values(live.agents).find((agent) => agent.role === "orchestrator")
      ?.id ??
    "";
  const running =
    ["working", "starting"].includes(
      live.agents[currentAgentId]?.status ?? ""
    ) && isMissionActive(live.mission.status);
  const parts = conversationParts(
    live,
    entries,
    worker,
    currentAgentId,
    running
  );
  const timedByWork = parts.some(
    (part) => part.kind === "work" && part.running
  );
  return {
    currentAgentId,
    entries,
    goalBubble,
    parts,
    running,
    timedByWork,
    transcript,
    worker,
  };
};

const fixture = () => {
  const main = AgentSchema.parse({
    assignmentId: null,
    createdAt: AT,
    holdsWriteLease: false,
    id: "a-1",
    missionId: "m-1",
    model: { modelId: "fixture", reasoningEffort: null },
    role: "orchestrator",
    sessionId: "session-main",
    status: "working",
    title: "Orchestrator",
    updatedAt: AT,
    workingState: "working",
  });
  const worker = {
    ...main,
    assignmentId: "assignment-1",
    id: "worker-1",
    role: "worker" as const,
    title: "Worker",
  };
  const item = transcriptItem(1);
  const live = fromSnapshot(
    snapshot({
      agents: [main, worker],
      assignments: [
        {
          createdAt: AT,
          epoch: 0,
          handoff: null,
          id: "assignment-1",
          instructions: "Review",
          missionId: "m-1",
          needsWrite: false,
          status: "running",
          title: "Review",
          updatedAt: AT,
          workerAgentId: worker.id,
        },
      ],
      permissions: [permission("pending")],
      plans: [plan("proposed")],
      questions: [question("answered")],
      queue: [queueItem(2, "sent")],
      transcript: [
        { ...item, kind: "user", requestId: "m-1:goal" },
        {
          ...transcriptItem(2),
          kind: "tool_call",
          toolName: "Execute",
          toolUseId: "command",
        },
        {
          ...transcriptItem(3),
          isError: true,
          kind: "tool_result",
          text: "exit 1",
          toolUseId: "command",
        },
        { ...transcriptItem(4), agentId: worker.id, kind: "thinking" },
        { ...transcriptItem(5), agentId: worker.id },
        {
          ...transcriptItem(6),
          agentId: worker.id,
          kind: "agent_message",
          recipient: { agentId: main.id, role: main.role, title: main.title },
          requestId: "queue-1",
          sender: {
            agentId: worker.id,
            role: worker.role,
            title: worker.title,
          },
        },
        transcriptItem(7),
        {
          ...transcriptItem(8),
          kind: "tool_call",
          toolName: "dispatch_worker",
          toolUseId: "failed-role-call",
        },
        {
          ...transcriptItem(9),
          isError: true,
          kind: "tool_result",
          toolUseId: "failed-role-call",
        },
      ],
    })
  );
  live.previews = {
    main: {
      agentId: main.id,
      chunks: { 50: "Streaming ", 51: "reply" },
      kind: "text",
      messageId: "preview-main",
    },
    worker: {
      agentId: worker.id,
      chunks: { 52: "Thinking" },
      kind: "thinking",
      messageId: "preview-worker",
    },
  };
  return live;
};

describe("conversation projection, eafc235 corpus", () => {
  it("freezes complete structures, ties, participants, history and running state", () => {
    const mixed = fixture();
    const cases = {
      empty: fromSnapshot(snapshot({ transcript: [] })),
      missingAgents: { ...mixed, agents: {} },
      mixed,
      paginated: { ...mixed, transcriptHasMore: true },
      settled: {
        ...mixed,
        mission: { ...mixed.mission, status: "paused" as const },
        previews: {},
      },
    };
    const outputs = Object.entries(cases).flatMap(([name, live]) =>
      [undefined, "a-1", "worker-1", "missing"].map((agentId) => ({
        agentId,
        name,
        projection: project(live, agentId),
      }))
    );
    expect(outputs).toMatchSnapshot("eafc235 complete projection tuples");
  });

  it("records the unchanged long-conversation workload without inventing a budget", () => {
    const live = fixture();
    live.transcript = Object.fromEntries(
      Array.from({ length: 2000 }, (_, index) => {
        const item = transcriptItem(index);
        return [item.id, { ...item, kind: index % 2 ? "assistant" : "user" }];
      })
    );
    const samples = Array.from({ length: 7 }, () => {
      const start = performance.now();
      const result = project(live, "a-1");
      return { count: result.transcript.length, ms: performance.now() - start };
    });
    expect(samples.map((sample) => sample.count)).toStrictEqual(
      Array.from({ length: 7 }, () => 2000)
    );
    console.info("[conversation-cost]", JSON.stringify(samples));
  });
});
