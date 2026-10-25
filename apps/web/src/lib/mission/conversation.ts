import type { TranscriptItem } from "@missions/protocol/missions";

import type { MissionLiveState } from "../live/mission-state";
import type { TimelineEntry } from "./timeline";
import { buildTimeline, turnParts } from "./timeline";

/** An agent message is one record shown in both participants' views. */
export const conversationTranscript = (
  transcript: Readonly<MissionLiveState["transcript"]>,
  agentId?: string
) =>
  Object.values(transcript).filter(
    (item) =>
      !agentId ||
      item.agentId === agentId ||
      (item.kind === "agent_message" &&
        (item.sender?.agentId === agentId ||
          item.recipient?.agentId === agentId))
  );

export const conversationEntries = (
  live: Pick<
    MissionLiveState,
    | "assignments"
    | "agents"
    | "permissions"
    | "plans"
    | "previews"
    | "questions"
  >,
  transcript: readonly TranscriptItem[],
  agentId: string | undefined,
  worker: boolean
) =>
  buildTimeline({
    assignments: worker ? [] : Object.values(live.assignments),
    permissions: Object.values(live.permissions),
    planAgentId: worker ? undefined : agentId,
    planInFlight:
      !worker &&
      !!agentId &&
      ["working", "starting"].includes(live.agents[agentId]?.status ?? ""),
    plans: worker ? [] : Object.values(live.plans),
    previews: Object.values(live.previews),
    questions: Object.values(live.questions),
    transcript,
  }).filter(
    (entry) =>
      !agentId ||
      entry.agentId === agentId ||
      entry.kind === "agent_message" ||
      (!worker &&
        (entry.agentId === null ||
          entry.kind === "permission" ||
          entry.kind === "question"))
  );

export const conversationParts = (
  live: Pick<MissionLiveState, "agents" | "queue">,
  entries: readonly TimelineEntry[],
  worker: boolean,
  currentAgentId: string,
  running: boolean
) => {
  const visible = worker
    ? entries
    : entries.filter(
        (entry) =>
          entry.agentId === null ||
          live.agents[entry.agentId]?.role !== "worker" ||
          !["assistant", "preview", "thinking", "tools"].includes(entry.kind)
      );
  const delivered = new Set(
    Object.values(live.queue)
      .filter((item) => item.state === "sent")
      .map((item) => item.id)
  );
  return turnParts(visible, currentAgentId, running, delivered);
};
