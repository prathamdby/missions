import type { QueueItem, TranscriptItem } from "@missions/protocol/missions";
import { describe, expect, it } from "vitest";

import {
  deliveredRequestIds,
  deliveryOf,
  goalRequestId,
  isEditable,
  isRetryable,
  QUEUE_LINGER_MS,
  showGoalBubble,
  visibleQueue,
} from "./queue";

const NOW = Date.parse("2026-01-01T00:01:00.000Z");
const iso = (ms: number) => new Date(ms).toISOString();

const entry = (
  id: string,
  state: QueueItem["state"],
  updatedAgoMs = 0,
  replacedById: string | null = null
): QueueItem => ({
  agentId: "a",
  createdAt: iso(NOW - 60_000 + (id.codePointAt(0) ?? 0)),
  error: null,
  executionMode: null,
  id,
  missionId: "m",
  mode: "queue",
  origin: "user",
  purpose: "message",
  replacedById,
  replacesId: null,
  retryOf: null,
  revision: 1,
  sender: null,
  sequence: 0,
  state,
  text: id,
  updatedAt: iso(NOW - updatedAgoMs),
});

describe(visibleQueue, () => {
  it("keeps pending, failed, and unknown items regardless of age", () => {
    const items = [
      entry("a", "queued", 99_999),
      entry("b", "failed", 99_999),
      entry("c", "unknown", 99_999),
      entry("d", "submitting", 99_999),
    ];
    expect(visibleQueue(items, NOW).map((item) => item.id)).toStrictEqual([
      "a",
      "b",
      "c",
      "d",
    ]);
  });

  it("lets settled items linger briefly, and hides replaced ones at once", () => {
    const items = [
      entry("e", "sent", QUEUE_LINGER_MS - 1),
      entry("f", "sent", QUEUE_LINGER_MS + 1),
      entry("g", "removed", 0, "h"),
      entry("h", "queued"),
    ];
    expect(visibleQueue(items, NOW).map((item) => item.id)).toStrictEqual([
      "e",
      "h",
    ]);
  });
});

const userItem = (requestId: string | null): TranscriptItem => ({
  agentId: "a",
  createdAt: iso(NOW),
  id: `t-${requestId ?? "none"}`,
  isError: false,
  kind: "user",
  missionId: "m",
  purpose: null,
  recipient: null,
  requestId,
  sender: null,
  seq: 1,
  text: "hello",
  toolName: null,
  toolUseId: null,
});

describe("transcript dedupe", () => {
  it("hides queue items whose message is already in the transcript", () => {
    const delivered = deliveredRequestIds([userItem("a"), userItem(null)]);
    const items = [entry("a", "sent"), entry("b", "queued")];
    expect(
      visibleQueue(items, NOW, delivered).map((item) => item.id)
    ).toStrictEqual(["b"]);
  });

  it("shows the goal bubble only until the goal message arrives", () => {
    const goal = goalRequestId("m");
    expect(showGoalBubble("m", new Set(), false)).toBeTruthy();
    expect(showGoalBubble("m", new Set([goal]), false)).toBeFalsy();
    expect(showGoalBubble("m", new Set(), true)).toBeFalsy();
  });
});

describe("queue delivery", () => {
  it("hides retried originals, daemon items, and agent items that delivered", () => {
    const items = [
      entry("a", "failed"),
      { ...entry("b", "queued"), retryOf: "a" },
      { ...entry("c", "queued"), origin: "daemon" as const },
      { ...entry("d", "queued"), origin: "agent" as const },
      { ...entry("e", "unknown"), origin: "agent" as const },
    ];
    expect(visibleQueue(items, NOW).map((item) => item.id)).toStrictEqual([
      "b",
      "e",
    ]);
  });

  it("keeps accepted user items editable but not agent items", () => {
    expect(isEditable(entry("a", "accepted"))).toBeTruthy();
    expect(isEditable(entry("a", "submitting"))).toBeFalsy();
    expect(
      isEditable({ ...entry("a", "queued"), origin: "agent" })
    ).toBeFalsy();
    expect(isRetryable(entry("a", "unknown"))).toBeTruthy();
    expect(isRetryable(entry("a", "queued"))).toBeFalsy();
  });

  it("follows retries to the newest attempt", () => {
    const queue = {
      a: entry("a", "failed"),
      b: { ...entry("b", "unknown"), retryOf: "a" },
      c: { ...entry("c", "sent"), retryOf: "b" },
      d: entry("d", "removed"),
    };
    expect(deliveryOf(queue, "a")).toBe("sent");
    expect(deliveryOf({ a: queue.a, b: queue.b }, "a")).toBe("unknown");
    expect(deliveryOf(queue, "d")).toBe("failed");
    expect(deliveryOf({ x: entry("x", "accepted") }, "x")).toBe("pending");
  });

  it("has no delivery state for an unloaded queue item", () => {
    expect(deliveryOf({}, "missing")).toBeNull();
    expect(deliveryOf({}, null)).toBeNull();
  });
});
