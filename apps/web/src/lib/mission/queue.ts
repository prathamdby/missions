import type { QueueItem } from "@missions/protocol/missions";

/** How long delivered or removed items stay visible so the change registers. */
export const QUEUE_LINGER_MS = 4000;

const SETTLED: ReadonlySet<QueueItem["state"]> = new Set([
  "sent",
  "removed",
  "discarded",
]);

/** Pending items, recent settled ones, and failed/unknown ones until resolved. */
export const visibleQueue = (items: readonly QueueItem[], now: number) =>
  items
    .filter((item) => {
      if (!SETTLED.has(item.state)) {
        return true;
      }
      if (item.replacedById !== null) {
        return false;
      }
      return now - Date.parse(item.updatedAt) < QUEUE_LINGER_MS;
    })
    .toSorted((a, b) => a.createdAt.localeCompare(b.createdAt));

export const isEditable = (item: QueueItem) => item.state === "queued";
