import type { QueueItem } from "@missions/protocol/missions";
import { describe, expect, it } from "vitest";

import { AT } from "@/lib/live/test-adapters";

import {
  latestEditable,
  queuedEditEnd,
  resolveQueuedEditExit,
} from "./queued-edit";

const item = (
  overrides: Partial<QueueItem> = {},
  state: QueueItem["state"] = "accepted"
): QueueItem => ({
  agentId: "a-1",
  attachments: [],
  createdAt: AT,
  error: null,
  id: "queue-1",
  missionId: "m-1",
  mode: "queue",
  origin: "user",
  purpose: "message",
  replacedById: null,
  replacesId: null,
  retryOf: null,
  revision: 1,
  sender: null,
  sequence: 0,
  state,
  text: "Fix it",
  updatedAt: AT,
  ...overrides,
});

describe(resolveQueuedEditExit, () => {
  it("closes an unchanged edit without touching the composer", () => {
    expect(
      resolveQueuedEditExit({ editChanged: false, missionDraftEmpty: true })
    ).toBe("clean");
    expect(
      resolveQueuedEditExit({ editChanged: false, missionDraftEmpty: false })
    ).toBe("clean");
  });

  it("keeps a changed edit only when the composer is empty", () => {
    expect(
      resolveQueuedEditExit({ editChanged: true, missionDraftEmpty: true })
    ).toBe("kept");
    expect(
      resolveQueuedEditExit({ editChanged: true, missionDraftEmpty: false })
    ).toBe("discarded");
  });
});

describe(queuedEditEnd, () => {
  it("keeps an accepted or queued message editable", () => {
    expect(queuedEditEnd(item({}, "accepted"))).toBeNull();
    expect(queuedEditEnd(item({}, "queued"))).toBeNull();
  });

  it("names why the edit has to end", () => {
    expect(queuedEditEnd(undefined)).toBe("gone");
    expect(queuedEditEnd(item({}, "sent"))).toBe("delivered");
    expect(queuedEditEnd(item({ replacedById: "queue-2" }))).toBe("replaced");
    expect(queuedEditEnd(item({}, "submitting"))).toBe("gone");
  });

  it("ignores messages the user cannot edit", () => {
    expect(queuedEditEnd(item({ origin: "agent" }))).toBe("gone");
    expect(queuedEditEnd(item({ origin: "daemon" }))).toBe("gone");
  });
});

describe(latestEditable, () => {
  it("picks the newest editable message, not a settled one", () => {
    const older = item({ createdAt: AT, id: "older" }, "accepted");
    const newer = item(
      { createdAt: "2026-01-01T00:01:00.000Z", id: "newer" },
      "queued"
    );
    const sent = item(
      { createdAt: "2026-01-01T00:02:00.000Z", id: "sent" },
      "sent"
    );
    expect(latestEditable([older, newer, sent])?.id).toBe("newer");
  });

  it("returns nothing when every message has settled", () => {
    const settled = latestEditable([
      item({}, "sent"),
      item({ id: "b" }, "failed"),
    ]);
    expect(settled).toBeUndefined();
  });
});
