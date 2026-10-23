import type { Agent, WaitingReason } from "@missions/protocol/missions";

/** Why an agent has no output yet: a sentence and a label for tight spaces. */
export const WAITING: Record<WaitingReason, { long: string; short: string }> = {
  answer: { long: "Waiting for your answer", short: "Needs you" },
  model: { long: "Confirming the model", short: "Model" },
  permission: { long: "Waiting for your approval", short: "Needs you" },
  reconnecting: { long: "Reconnecting to the agent", short: "Reconnecting" },
  retry: { long: "Provider busy, retrying", short: "Retrying" },
  startup: { long: "Starting the agent", short: "Starting" },
  write_lease: { long: "Waiting for write access", short: "Write access" },
};

const ENDED: ReadonlySet<Agent["status"]> = new Set([
  "failed",
  "interrupted",
  "stopped",
]);

/** The agent's current waiting reason; stale reasons on stopped agents are ignored. */
export const waitingOf = (agent: Agent | undefined): WaitingReason | null =>
  agent && !ENDED.has(agent.status) ? agent.waitingReason : null;
