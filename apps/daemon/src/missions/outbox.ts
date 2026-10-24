import type { QueueItem } from "@missions/protocol/missions";

/**
 * Pure ordering and capacity rules for the durable message outbox. The queue
 * table is the outbox: `accepted` rows are definitely unsent and dispatch in
 * per-mission sequence order once their recipient can take them.
 */

/** States that still occupy a recipient's delivery capacity. */
const OUTSTANDING = new Set<QueueItem["state"]>([
  "accepted",
  "submitting",
  "queued",
  "removing",
]);

export const nextSequence = (items: readonly QueueItem[]) => {
  let max = 0;
  for (const item of items) {
    max = Math.max(max, item.sequence);
  }
  return max + 1;
};

export const isOutstanding = (item: QueueItem) => OUTSTANDING.has(item.state);

/** Accepted messages for one recipient, oldest admission first. */
export const deliverableFor = (items: readonly QueueItem[], agentId: string) =>
  items
    .filter((item) => item.agentId === agentId && item.state === "accepted")
    .toSorted(
      (a, b) =>
        a.sequence - b.sequence || a.createdAt.localeCompare(b.createdAt)
    );

/**
 * Idempotency identity: retrying an ID returns its receipt only when every
 * intent field matches. Text is compared for identity, never used to merge
 * two intentional messages.
 */
export const sameMessage = (
  item: QueueItem,
  intent: Pick<QueueItem, "agentId" | "mode" | "text"> & {
    missionId: string;
    attachmentIds?: readonly string[];
  }
) =>
  item.missionId === intent.missionId &&
  item.agentId === intent.agentId &&
  item.text === intent.text &&
  JSON.stringify(item.attachments.map((ref) => ref.id)) ===
    JSON.stringify(intent.attachmentIds ?? []) &&
  item.mode === intent.mode &&
  item.replacesId === null;
