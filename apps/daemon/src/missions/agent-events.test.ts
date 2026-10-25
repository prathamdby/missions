import { randomUUID } from "node:crypto";

import { IdSchema } from "@missions/protocol/common";
import { describe, expect, it } from "vitest";

import {
  agentEventStillValid,
  parseAgentEventId,
  workerBlockedId,
  workerFailedId,
  workerStalledId,
  workerStallResolvedId,
  workerUnblockedId,
} from "./agent-events";
import type { AgentEventFacts } from "./agent-events";
import { workerTurnKey } from "./worker-turns";

const facts = (changes: Partial<AgentEventFacts> = {}): AgentEventFacts => ({
  assignmentStatus: null,
  missionEpoch: 3,
  wait: null,
  ...changes,
});

describe("agent events", () => {
  it("round-trips bounded stalled and resolved IDs even for long native turn IDs", () => {
    const assignmentId = randomUUID();
    const turnKey = workerTurnKey("session".repeat(100), "turn".repeat(100));
    const ids = [
      workerStalledId(assignmentId, 12, turnKey),
      workerStallResolvedId(assignmentId, 12, turnKey),
    ];
    expect(ids.map(parseAgentEventId)).toStrictEqual([
      { assignmentId, epoch: 12, kind: "worker-stalled", turnKey },
      { assignmentId, epoch: 12, kind: "worker-stall-resolved", turnKey },
    ]);
    expect(
      ids.every((id) => IdSchema.safeParse(`${id}:record`).success)
    ).toBeTruthy();
    expect(workerTurnKey("first-session", "turn")).not.toBe(
      workerTurnKey("second-session", "turn")
    );
    expect(workerTurnKey("first-session", "turn")).toBe(
      workerTurnKey("first-session", "turn")
    );
    expect(
      ["evt:worker-stalled:a:bad:turn", "evt:worker-stalled:a:1:"].map(
        parseAgentEventId
      )
    ).toStrictEqual([null, null]);
  });

  it("requires the current closed episode, running assignment and epoch for a stall, not idle status", () => {
    const event = {
      assignmentId: "assignment",
      epoch: 3,
      kind: "worker-stalled",
      turnKey: "turn",
    } as const;
    const current = {
      assignmentStatus: "running",
      stallCurrent: true,
    } as const;
    expect([
      agentEventStillValid(event, facts(current)),
      agentEventStillValid(event, facts({ ...current, stallCurrent: false })),
      agentEventStillValid(
        event,
        facts({ ...current, assignmentStatus: "handed_off" })
      ),
      agentEventStillValid(event, facts({ ...current, missionEpoch: 4 })),
      agentEventStillValid(
        { ...event, kind: "worker-stall-resolved" },
        facts({ ...current, stallCurrent: false })
      ),
      agentEventStillValid(
        { ...event, kind: "worker-stall-resolved" },
        facts(current)
      ),
    ]).toStrictEqual([true, false, false, false, true, false]);
  });

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
