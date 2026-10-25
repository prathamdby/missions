import { createHash } from "node:crypto";

import type { AgentEvent } from "../runtime/contracts";

const ACTIVITY_EVENTS = new Set([
  "text_delta",
  "thinking_delta",
  "tool_call",
  "permission_denied",
  "retry",
]);

export const workerEpisodeActivity = (event: AgentEvent) =>
  event.type === "working_state"
    ? event.state !== "idle"
    : ACTIVITY_EVENTS.has(event.type) ||
      (event.type === "message" && event.message.role === "user");

const DIAGNOSTIC_LIMIT = 250;

/** SDK 0.10 completion reasons. Unknown reasons stay recoverable and diagnostic. */
const WORKER_COMPLETION_OUTCOMES = {
  cancelled: "stalled",
  completed: "stalled",
  completion_persistence_failed: "failed",
  error: "failed",
  model_authentication_failed: "failed",
  model_provider_unavailable: "failed",
  model_provider_unreachable: "failed",
  model_rate_limited: "stalled",
  model_request_rejected: "failed",
  model_usage_exhausted: "failed",
  no_approver_available: "stalled",
  permission_rejected: "stalled",
  process_exit: "failed",
  prompt_rejected: "failed",
  spec_handoff: "stalled",
  structured_output_invalid: "failed",
  structured_output_missing: "failed",
  structured_output_schema_invalid: "failed",
} as const;

export const workerCompletionOutcome = (reason: string) =>
  Object.hasOwn(WORKER_COMPLETION_OUTCOMES, reason)
    ? WORKER_COMPLETION_OUTCOMES[
        reason as keyof typeof WORKER_COMPLETION_OUTCOMES
      ]
    : "stalled";

/** Independent of SDK working state, which can arrive before or after completion. */
export interface WorkerEpisode {
  key: string;
  closed: boolean;
  resolved: boolean;
  noticeId: string | null;
  lastTool: string | null;
  toolError: string | null;
  denial: string | null;
  sdkError: string | null;
}

export const workerEpisode = (
  generation: string,
  counter: number
): WorkerEpisode => ({
  closed: false,
  denial: null,
  key: `${generation}-${counter}`,
  lastTool: null,
  noticeId: null,
  resolved: false,
  sdkError: null,
  toolError: null,
});

export const workerEpisodeDetail = (episode: WorkerEpisode) =>
  [
    episode.lastTool &&
      `Last tool: ${episode.lastTool.slice(0, DIAGNOSTIC_LIMIT)}`,
    episode.toolError &&
      `Tool error: ${episode.toolError.slice(0, DIAGNOSTIC_LIMIT)}`,
    episode.denial &&
      `Permission denial: ${episode.denial.slice(0, DIAGNOSTIC_LIMIT)}`,
    episode.sdkError &&
      `SDK error: ${episode.sdkError.slice(0, DIAGNOSTIC_LIMIT)}`,
  ]
    .filter(Boolean)
    .join("; ");

export const workerTurnKey = (sessionId: string, turnId: string) =>
  createHash("sha256")
    .update(JSON.stringify([sessionId, turnId]))
    .digest("hex")
    .slice(0, 32);
