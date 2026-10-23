import type { QueueItem, TranscriptItem } from "@missions/protocol/missions";

/** How long delivered or removed items stay visible so the change registers. */
export const QUEUE_LINGER_MS = 4000;

const SETTLED: ReadonlySet<QueueItem["state"]> = new Set([
  "sent",
  "removed",
  "discarded",
]);

/** Delivery went wrong or may have; only an explicit retry sends it again. */
const UNRESOLVED: ReadonlySet<QueueItem["state"]> = new Set([
  "failed",
  "unknown",
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

/** Originals the user already retried; the retry carries the message now. */
const retriedIds = (items: readonly QueueItem[]) =>
  new Set(
    items.flatMap((item) => (item.retryOf === null ? [] : [item.retryOf]))
  );

/**
 * Pending items, recent settled ones, and failed/unknown ones until retried.
 * Agent reports only show when their delivery failed or is uncertain; daemon
 * control messages never show. Items in `hidden` (already in the transcript,
 * or the goal) never show.
 */
export const visibleQueue = (
  items: readonly QueueItem[],
  now: number,
  hidden: ReadonlySet<string> = NONE
) => {
  const retried = retriedIds(items);
  return items
    .filter((item) => {
      if (hidden.has(item.id) || retried.has(item.id)) {
        return false;
      }
      if (item.origin === "daemon") {
        return false;
      }
      if (item.origin === "agent") {
        return UNRESOLVED.has(item.state);
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
};

/** Accepted items have not reached the native runner yet, so they stay editable. */
export const isEditable = (item: QueueItem) =>
  item.origin === "user" &&
  (item.state === "queued" || item.state === "accepted");

export const isRetryable = (item: QueueItem) => UNRESOLVED.has(item.state);

export type DeliveryState =
  | "failed"
  | "pending"
  | "removed"
  | "sent"
  | "unknown";

/** Follows explicit retries from `item` to the newest attempt. */
const latestAttempt = (
  queue: Readonly<Record<string, QueueItem>>,
  item: QueueItem
) => {
  const retries = new Map<string, QueueItem>();
  for (const candidate of Object.values(queue)) {
    if (candidate.retryOf !== null) {
      retries.set(candidate.retryOf, candidate);
    }
  }
  const seen = new Set<string>([item.id]);
  let current = item;
  let next = retries.get(current.id);
  while (next && !seen.has(next.id)) {
    seen.add(next.id);
    current = next;
    next = retries.get(current.id);
  }
  return current;
};

/**
 * Where an agent message stands, following explicit retries to the newest
 * attempt. Null when its queue item is not loaded.
 */
export const deliveryOf = (
  queue: Readonly<Record<string, QueueItem>>,
  requestId: string | null
): DeliveryState | null => {
  const original = requestId === null ? undefined : queue[requestId];
  if (!original) {
    return null;
  }
  const { state } = latestAttempt(queue, original);
  if (state === "sent" || state === "failed" || state === "unknown") {
    return state;
  }
  return SETTLED.has(state) ? "removed" : "pending";
};
