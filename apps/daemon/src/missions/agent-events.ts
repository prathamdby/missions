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
  | {
      kind: "worker-stalled" | "worker-stall-resolved";
      assignmentId: string;
      epoch: number;
      turnKey: string;
    }
  | { kind: "worker-blocked" | "worker-unblocked"; waitId: string };

const FAILED = `${EVENT_PREFIX}worker-failed:`;
const BLOCKED = `${EVENT_PREFIX}worker-blocked:`;
const UNBLOCKED = `${EVENT_PREFIX}worker-unblocked:`;
const STALLED = `${EVENT_PREFIX}worker-stalled:`;
const RESOLVED = `${EVENT_PREFIX}worker-stall-resolved:`;
const EPOCH = /^\d+$/u;
const TURN_EVENT = /^(?<assignmentId>.+):(?<epoch>\d+):(?<turnKey>[^:]+)$/u;

export const workerFailedId = (assignmentId: string, epoch: number) =>
  `${FAILED}${assignmentId}:${epoch}`;

export const workerStalledId = (
  assignmentId: string,
  epoch: number,
  turnKey: string
) => `${STALLED}${assignmentId}:${epoch}:${turnKey}`;

export const workerStallResolvedId = (
  assignmentId: string,
  epoch: number,
  turnKey: string
) => `${RESOLVED}${assignmentId}:${epoch}:${turnKey}`;

/** `waitId` is the ID of the Worker's pending permission request or question. */
export const workerBlockedId = (waitId: string) => `${BLOCKED}${waitId}`;

export const workerUnblockedId = (waitId: string) => `${UNBLOCKED}${waitId}`;

export const parseAgentEventId = (id: string): AgentEventRef | null => {
  for (const [prefix, kind] of [
    [STALLED, "worker-stalled"],
    [RESOLVED, "worker-stall-resolved"],
  ] as const) {
    if (id.startsWith(prefix)) {
      const match = TURN_EVENT.exec(id.slice(prefix.length))?.groups;
      return match?.assignmentId && match.epoch && match.turnKey
        ? {
            assignmentId: match.assignmentId,
            epoch: Number(match.epoch),
            kind,
            turnKey: match.turnKey,
          }
        : null;
    }
  }
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
  stallCurrent?: boolean;
}

/** Checked just before delivery; an event that fails it is discarded unsent. */
export const agentEventStillValid = (
  event: AgentEventRef,
  facts: AgentEventFacts
) => {
  switch (event.kind) {
    case "worker-stalled": {
      return (
        event.epoch === facts.missionEpoch &&
        facts.assignmentStatus === "running" &&
        facts.stallCurrent === true
      );
    }
    case "worker-stall-resolved": {
      return event.epoch === facts.missionEpoch && facts.stallCurrent === false;
    }
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
