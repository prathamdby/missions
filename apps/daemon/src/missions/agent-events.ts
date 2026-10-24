import type { Assignment } from "@missions/protocol/missions";

/**
 * Agent events are daemon notices to the main agent about a Worker's
 * lifecycle. Each episode has one deterministic outbox ID that doubles as its
 * dedupe key. The prefix is deliberately not `sys:`, because system requests
 * skip queue tracking and events must be tracked to `sent`.
 */
const EVENT_PREFIX = "evt:";

export type AgentEventRef =
  | { kind: "worker-failed"; assignmentId: string; epoch: number }
  | { kind: "worker-blocked" | "worker-unblocked"; waitId: string };

const FAILED = `${EVENT_PREFIX}worker-failed:`;
const BLOCKED = `${EVENT_PREFIX}worker-blocked:`;
const UNBLOCKED = `${EVENT_PREFIX}worker-unblocked:`;
const EPOCH = /^\d+$/u;

export const workerFailedId = (assignmentId: string, epoch: number) =>
  `${FAILED}${assignmentId}:${epoch}`;

/** `waitId` is the ID of the Worker's pending permission request or question. */
export const workerBlockedId = (waitId: string) => `${BLOCKED}${waitId}`;

export const workerUnblockedId = (waitId: string) => `${UNBLOCKED}${waitId}`;

export const parseAgentEventId = (id: string): AgentEventRef | null => {
  if (id.startsWith(FAILED)) {
    const rest = id.slice(FAILED.length);
    const split = rest.lastIndexOf(":");
    const assignmentId = rest.slice(0, split);
    const epoch = rest.slice(split + 1);
    return split > 0 && EPOCH.test(epoch)
      ? { assignmentId, epoch: Number(epoch), kind: "worker-failed" }
      : null;
  }
  for (const [prefix, kind] of [
    [BLOCKED, "worker-blocked"],
    [UNBLOCKED, "worker-unblocked"],
  ] as const) {
    if (id.startsWith(prefix) && id.length > prefix.length) {
      return { kind, waitId: id.slice(prefix.length) };
    }
  }
  return null;
};

/** What the daemon currently knows about an event's subject. */
export interface AgentEventFacts {
  missionEpoch: number;
  assignmentStatus: Assignment["status"] | null;
  /** The permission request or question the event refers to. */
  wait: { status: string; epoch: number } | null;
}

/** Checked just before delivery; an event that fails it is discarded unsent. */
export const agentEventStillValid = (
  event: AgentEventRef,
  facts: AgentEventFacts
) => {
  switch (event.kind) {
    case "worker-failed": {
      return (
        facts.assignmentStatus === "failed" &&
        event.epoch === facts.missionEpoch
      );
    }
    case "worker-blocked": {
      return (
        facts.wait?.status === "pending" &&
        facts.wait.epoch === facts.missionEpoch
      );
    }
    default: {
      return facts.wait?.epoch === facts.missionEpoch;
    }
  }
};
