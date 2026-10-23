import { describe, expect, it } from "vitest";

import {
  normalizeAgent,
  normalizeMission,
  normalizePlan,
  normalizeQueueItem,
  normalizeTranscriptItem,
} from "./normalize";

describe("v1 document normalization", () => {
  it("fills fields added in v2 without overriding stored values", () => {
    expect({
      agent: normalizeAgent({ id: "a" }),
      mission: normalizeMission({ id: "m" }),
      storedMode: normalizeMission({ executionMode: "plan", id: "m" })
        .executionMode,
    }).toStrictEqual({
      agent: {
        id: "a",
        previousSessionIds: [],
        promptVersion: null,
        sessionGeneration: 0,
        waitingReason: null,
      },
      mission: {
        endedAt: null,
        executionMode: "work",
        id: "m",
        pendingExecutionMode: null,
      },
      storedMode: "plan",
    });
  });

  it("keeps legacy plans historical and legacy messages from users", () => {
    expect({
      plan: normalizePlan({ id: "p", status: "proposed" }),
      queue: normalizeQueueItem({ id: "q", state: "queued" }),
      transcript: normalizeTranscriptItem({
        id: "t",
        kind: "system",
        text: "Worker finished assignment",
      }),
    }).toStrictEqual({
      plan: {
        actionable: false,
        agentId: null,
        epoch: null,
        guidanceVersion: null,
        id: "p",
        sessionId: null,
        status: "proposed",
        toolUseId: null,
      },
      queue: {
        executionMode: null,
        id: "q",
        origin: "user",
        purpose: "message",
        retryOf: null,
        sender: null,
        sequence: 0,
        state: "queued",
      },
      transcript: {
        id: "t",
        kind: "system",
        purpose: null,
        recipient: null,
        sender: null,
        text: "Worker finished assignment",
      },
    });
  });
});
