import { randomUUID } from "node:crypto";

import { IdSchema } from "@missions/protocol/common";
import { describe, expect, it } from "vitest";

import {
  agentEventStillValid,
  parseAgentEventId,
  workerBlockedId,
  workerFailedId,
  workerUnblockedId,
} from "./agent-events";
import type { AgentEventFacts } from "./agent-events";

const facts = (changes: Partial<AgentEventFacts> = {}): AgentEventFacts => ({
  assignmentStatus: null,
  missionEpoch: 3,
  wait: null,
  ...changes,
});

describe("agent events", () => {
  it("round-trips every event ID within the protocol ID limit", () => {
    const waitId = randomUUID();
    const ids = [
      workerFailedId("a1b2c3d4", 12),
      workerBlockedId(waitId),
      workerUnblockedId(waitId),
    ];
    expect(ids.map(parseAgentEventId)).toStrictEqual([
      { assignmentId: "a1b2c3d4", epoch: 12, kind: "worker-failed" },
      { kind: "worker-blocked", waitId },
      { kind: "worker-unblocked", waitId },
    ]);
    expect(ids.every((id) => IdSchema.safeParse(id).success)).toBeTruthy();
  });

  it("does not parse system requests, user messages or malformed events", () => {
    expect(
      [
        "sys:resume:1:a",
        "msg:agent:1",
        "evt:worker-failed:a1b2",
        "evt:worker-failed:a1b2:x",
        "evt:worker-blocked:",
        "evt:other:x",
      ].map(parseAgentEventId)
    ).toStrictEqual([null, null, null, null, null, null]);
  });

  it("keeps a failure only while the assignment is failed in the same epoch", () => {
    const failed = {
      assignmentId: "a",
      epoch: 3,
      kind: "worker-failed",
    } as const;
    expect([
      agentEventStillValid(failed, facts({ assignmentStatus: "failed" })),
      agentEventStillValid(failed, facts({ assignmentStatus: "cancelled" })),
      agentEventStillValid(
        failed,
        facts({ assignmentStatus: "failed", missionEpoch: 4 })
      ),
    ]).toStrictEqual([true, false, false]);
  });

  it("keeps a blocked notice only while its wait is pending in the same epoch", () => {
    const blocked = { kind: "worker-blocked", waitId: "w" } as const;
    expect([
      agentEventStillValid(
        blocked,
        facts({ wait: { epoch: 3, status: "pending" } })
      ),
      agentEventStillValid(
        blocked,
        facts({ wait: { epoch: 3, status: "approved" } })
      ),
      agentEventStillValid(
        blocked,
        facts({ wait: { epoch: 2, status: "pending" } })
      ),
      agentEventStillValid(blocked, facts()),
    ]).toStrictEqual([true, false, false, false]);
  });

  it("keeps an unblocked notice only for a wait from the same epoch", () => {
    const unblocked = { kind: "worker-unblocked", waitId: "w" } as const;
    expect([
      agentEventStillValid(
        unblocked,
        facts({ wait: { epoch: 3, status: "denied" } })
      ),
      agentEventStillValid(
        unblocked,
        facts({ wait: { epoch: 2, status: "denied" } })
      ),
      agentEventStillValid(unblocked, facts()),
    ]).toStrictEqual([true, false, false]);
  });
});
