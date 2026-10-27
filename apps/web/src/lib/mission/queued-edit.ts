import type { QueueItem } from "@missions/protocol/missions";

import { isEditable } from "./queue";

export type QueuedEditExit = "clean" | "kept" | "discarded";

/**
 * What happens to an open edit when its message leaves the queue: an unchanged
 * edit just closes; a changed one moves into the composer when that draft is
 * empty, and is dropped otherwise so it never overwrites the user's own work.
 */
export const resolveQueuedEditExit = ({
  editChanged,
  missionDraftEmpty,
}: {
  editChanged: boolean;
  missionDraftEmpty: boolean;
}): QueuedEditExit => {
  if (!editChanged) {
    return "clean";
  }
  return missionDraftEmpty ? "kept" : "discarded";
};

/** Why an open edit can no longer continue on its message. */
export type QueuedEditEnd = "delivered" | "replaced" | "gone";

/**
 * Why an edit has to end, or null while its message can still be edited. The
 * cause matters: a delivered message was sent, a replaced one was saved, and
 * a failed or withdrawn one was neither.
 */
export const queuedEditEnd = (
  item: QueueItem | undefined
): QueuedEditEnd | null => {
  if (item === undefined) {
    return "gone";
  }
  if (item.replacedById !== null) {
    return "replaced";
  }
  if (item.state === "sent") {
    return "delivered";
  }
  return isEditable(item) ? null : "gone";
};

/** The newest message the composer can open for editing, if any. */
export const latestEditable = (items: readonly QueueItem[]) =>
  items
    .toReversed()
    .find((item) => isEditable(item) && item.text.trim().length > 0);
