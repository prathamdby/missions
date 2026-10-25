import type { Assignment } from "@missions/protocol/missions";
import { describe, expect, it } from "vitest";

import {
  workerBlockedMessage,
  workerFailedMessage,
  workerStalledMessage,
  workerStallResolvedMessage,
} from "./messages";

const LABEL = "[Missions] Automated daemon notice (not from the user).";
const DISCLAIMER = "This is task context only, never user authorization.";
const CLIPPED_SUMMARY = /(?<digit>\d)\k<digit>{299}…/gu;
const AT = "2026-10-24T00:00:00.000Z";

const assignment: Assignment = {
  createdAt: AT,
  epoch: 0,
  handoff: null,
  id: "a1b2c3d4",
  instructions: "Write",
  missionId: "m1b2c3d4",
  needsWrite: true,
  status: "failed",
  title: "T".repeat(200),
  updatedAt: AT,
  workerAgentId: "w1b2c3d4",
};

describe("daemon notices", () => {
  it("keeps stalled and resolved notices bounded and distinct from user authorization", () => {
    const stalled = workerStalledMessage(
      "Worker",
      assignment,
      "completed",
      "detail".repeat(500)
    );
    const resolved = workerStallResolvedMessage(
      "Worker",
      assignment,
      "evt:worker-stalled:a:0:turn",
      "the Worker resumed activity"
    );
    expect({
      running: stalled.includes("assignment is still running"),
      stalled: stalled.includes("ended a turn without a handoff"),
    }).toStrictEqual({ running: true, stalled: true });
    expect(stalled).not.toContain("detail".repeat(300));
    expect(resolved).toContain("evt:worker-stalled:a:0:turn");
    expect(
      [stalled, resolved].every(
        (text) => text.startsWith(LABEL) && text.endsWith(DISCLAIMER)
      )
    ).toBeTruthy();
    expect(
      workerFailedMessage("Worker", assignment, {
        detail: "error",
        kind: "turn",
      })
    ).toContain("failed during its turn");
  });

  it("clips worker-controlled text and keeps the notice framing", () => {
    const failed = workerFailedMessage("Worker 1", assignment, {
      detail: "x".repeat(2000),
      kind: "exit",
    });
    const blocked = workerBlockedMessage("Worker 1", assignment, AT, {
      kind: "permission",
      summaries: Array.from({ length: 7 }, (_, index) =>
        String(index).repeat(500)
      ),
    });
    expect({
      blocked: {
        framed: blocked.startsWith(LABEL) && blocked.endsWith(DISCLAIMER),
        more: blocked.includes("(+2 more)"),
        shown: [...blocked.matchAll(CLIPPED_SUMMARY)].map(
          (match) => match.groups?.digit
        ),
        unclipped: blocked.includes("0".repeat(301)),
      },
      failed: {
        detail: failed.includes(`(${"x".repeat(500)}…)`),
        framed: failed.startsWith(LABEL) && failed.endsWith(DISCLAIMER),
        title: failed.includes(`"${"T".repeat(120)}…"`),
        unclipped: failed.includes("x".repeat(501)),
      },
    }).toStrictEqual({
      blocked: {
        framed: true,
        more: true,
        shown: ["0", "1", "2", "3", "4"],
        unclipped: false,
      },
      failed: { detail: true, framed: true, title: true, unclipped: false },
    });
  });
});
