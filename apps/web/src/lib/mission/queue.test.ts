import type { QueueItem } from "@missions/protocol/missions";
import { describe, expect, it } from "vitest";

import { QUEUE_LINGER_MS, visibleQueue } from "./queue";

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
  id,
  missionId: "m",
  mode: "queue",
  replacedById,
  replacesId: null,
  revision: 1,
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
