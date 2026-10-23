import type { QueueItem, TranscriptItem } from "@missions/protocol/missions";

/** How long delivered or removed items stay visible so the change registers. */
export const QUEUE_LINGER_MS = 4000;

const SETTLED: ReadonlySet<QueueItem["state"]> = new Set([
  "sent",
  "removed",
  "discarded",
]);

const NONE: ReadonlySet<string> = new Set();

/** The daemon submits the mission goal as a queue item with this ID. */
export const goalRequestId = (missionId: string) => `${missionId}:goal`;

/** Request IDs that already show in the transcript as user messages. */
export const deliveredRequestIds = (
  transcript: readonly TranscriptItem[]
): ReadonlySet<string> => {
  const ids = new Set<string>();
  for (const item of transcript) {
    if (item.kind === "user" && item.requestId !== null) {
      ids.add(item.requestId);
    }
  }
  return ids;
};

/**
 * The goal bubble stands in for the goal until its transcript message
 * arrives. While older pages are unloaded the goal is somewhere above them.
 */
export const showGoalBubble = (
  missionId: string,
  delivered: ReadonlySet<string>,
  transcriptHasMore: boolean
) => !(transcriptHasMore || delivered.has(goalRequestId(missionId)));

/**
 * Pending items, recent settled ones, and failed/unknown ones until resolved.
 * Items in `hidden` (already in the transcript, or the goal) never show.
 */
export const visibleQueue = (
  items: readonly QueueItem[],
  now: number,
  hidden: ReadonlySet<string> = NONE
) =>
  items
    .filter((item) => {
      if (hidden.has(item.id)) {
        return false;
      }
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
