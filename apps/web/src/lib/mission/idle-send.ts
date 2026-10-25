import type {
  Agent,
  MissionStatus,
  QueueItem,
  TranscriptItem,
} from "@missions/protocol/missions";

import type { DraftAttachment } from "./message-draft";
import { deliveredRequestIds, isRetryable } from "./queue";

export interface IdleSubmission {
  id: string;
  text: string;
  attachments: readonly DraftAttachment[];
  failed: boolean;
}

/** Mission activity alone does not mean the Orchestrator has a running turn. */
export const orchestratorTurnRunning = (
  status: MissionStatus,
  agents: readonly Pick<Agent, "role" | "status">[]
) =>
  status === "setting_up" ||
  status === "awaiting_approval" ||
  agents.some(
    (agent) =>
      agent.role === "orchestrator" &&
      ["working", "starting", "waiting_answer", "waiting_permission"].includes(
        agent.status
      )
  );

/** Local presentation only. The outbox and native delivery modes are unchanged. */
export const inlineIdleSubmissions = (
  submissions: Readonly<Record<string, IdleSubmission>>,
  queue: Readonly<Record<string, QueueItem>>,
  transcript: readonly TranscriptItem[]
) => {
  const delivered = deliveredRequestIds(transcript);
  return Object.values(submissions).filter((submission) => {
    const item = queue[submission.id];
    return (
      !submission.failed &&
      !delivered.has(submission.id) &&
      !(
        item &&
        (isRetryable(item) || ["removed", "discarded"].includes(item.state))
      )
    );
  });
};
