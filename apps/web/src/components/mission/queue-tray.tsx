"use client";

import type { QueueItem } from "@missions/protocol/missions";
import { useMemo } from "react";

import {
  CheckIcon,
  ChevronRightIcon,
  ClockIcon,
  CloseIcon,
  WarningIcon,
} from "@/components/mission/icons";
import { useMission } from "@/components/mission/mission-context";
import { useMissionCommand } from "@/components/mission/use-mission-command";
import { Button, IconButton } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { inlineIdleSubmissions } from "@/lib/mission/idle-send";
import {
  deliveredRequestIds,
  goalRequestId,
  isEditable,
  isRetryable,
  visibleQueue,
} from "@/lib/mission/queue";
import { useNow } from "@/lib/use-now";
import { cn } from "@/lib/utils";

const MODE_LABEL = {
  queue: "Queued · sends when the turn ends",
  steer: "Steer · sends after the current tool call",
} as const;

const StateMark = ({ item }: { item: QueueItem }) => {
  switch (item.state) {
    case "submitting":
    case "removing": {
      return (
        <Spinner
          label={item.state === "removing" ? "Removing" : "Sending"}
          pattern="wave"
          size="sm"
        />
      );
    }
    case "sent": {
      return (
        <span className="flex text-success">
          <CheckIcon className="size-3.5" />
          <span className="sr-only">Sent</span>
        </span>
      );
    }
    case "failed":
    case "unknown": {
      return <WarningIcon className="size-3.5 text-warning" />;
    }
    case "accepted":
    case "queued": {
      return item.mode === "steer" ? (
        <ChevronRightIcon className="size-3.5 text-text-tertiary" />
      ) : (
        <ClockIcon className="size-3.5 text-text-tertiary" />
      );
    }
    default: {
      return <CloseIcon className="size-3.5 text-text-tertiary" />;
    }
  }
};

const SHORT_MODE = { queue: "Queue", steer: "Steer" } as const;

const stateText = (item: QueueItem) => {
  switch (item.state) {
    case "accepted": {
      return `Waiting to send · ${SHORT_MODE[item.mode]}`;
    }
    case "submitting": {
      return "Sending…";
    }
    case "removing": {
      return "Removing…";
    }
    case "sent": {
      return "Delivered";
    }
    case "removed":
    case "discarded": {
      return "Removed";
    }
    case "failed": {
      return item.error ? `Not sent: ${item.error}` : "Not sent";
    }
    case "unknown": {
      return "Delivery uncertain. It may have arrived; retrying may send it twice.";
    }
    default: {
      return MODE_LABEL[item.mode];
    }
  }
};

/** Sends a failed or uncertain message again as a new message. */
const RetryButton = ({ item }: { item: QueueItem }) => {
  const retry = useMissionCommand("retryQueue", "Could not retry the message");
  return (
    <Button
      data-testid="queue-retry"
      disabled={retry.isPending}
      onClick={() =>
        retry.mutate({ expectedRevision: item.revision, itemId: item.id })
      }
      size="sm"
      variant="ghost"
    >
      {retry.isPending ? "Retrying…" : "Retry"}
    </Button>
  );
};

/** Who an agent report is from and to, using the tab labels when known. */
const useRoute = (item: QueueItem) => {
  const { agentLabels, live } = useMission();
  if (item.origin !== "agent") {
    return null;
  }
  const recipient = live.agents[item.agentId];
  const from = item.sender
    ? (agentLabels[item.sender.agentId] ?? item.sender.title)
    : "An agent";
  const to = recipient
    ? (agentLabels[recipient.id] ?? recipient.title)
    : "an agent";
  return `${from} → ${to}`;
};

const QueueRow = ({
  editing,
  item,
  onBeginEdit,
  onCancelEdit,
  saving,
}: {
  editing: boolean;
  item: QueueItem;
  onBeginEdit: () => void;
  onCancelEdit: () => void;
  saving: boolean;
}) => {
  const editable = isEditable(item);
  const route = useRoute(item);
  const attachmentNames = item.attachments
    .map((attachment) => attachment.name)
    .join(", ");

  const mode = useMissionCommand("queueMode", "Could not change delivery");
  const remove = useMissionCommand(
    "removeQueue",
    "Could not remove the message"
  );
  return (
    <li
      aria-current={editing ? "true" : undefined}
      className={cn(
        "flex items-start gap-md px-md py-sm",
        editing && "bg-surface-active"
      )}
      data-state={item.state}
    >
      <span className="mt-2xs">
        <StateMark item={item} />
      </span>
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="type-micro text-text-tertiary">
          {route ? `${route} · ` : ""}
          {stateText(item)}
        </span>
        <span className="truncate type-caption text-text">
          {editing ? (
            <span className="sr-only">Editing queued message: </span>
          ) : null}
          {item.text || attachmentNames}
        </span>
        {item.text && item.attachments.length ? (
          <span className="truncate type-micro text-text-tertiary">
            {attachmentNames}
          </span>
        ) : null}
      </div>
      {isRetryable(item) ? <RetryButton item={item} /> : null}
      {editing ? (
        <Button
          className="shrink-0"
          onClick={onCancelEdit}
          size="sm"
          variant="ghost"
        >
          Cancel
        </Button>
      ) : null}
      {editable && !editing ? (
        <div className="flex shrink-0 items-center gap-2xs">
          <Button
            data-testid={
              item.mode === "steer"
                ? "queue-switch-to-queue"
                : "queue-switch-to-steer"
            }
            disabled={mode.isPending}
            onClick={() =>
              mode.mutate({
                expectedRevision: item.revision,
                itemId: item.id,
                mode: item.mode === "steer" ? "queue" : "steer",
              })
            }
            size="sm"
            variant="ghost"
          >
            {item.mode === "steer" ? "Queue instead" : "Steer instead"}
          </Button>
          {item.text.trim() ? (
            <Button
              aria-label="Edit queued message"
              disabled={saving}
              onClick={onBeginEdit}
              size="sm"
              variant="ghost"
            >
              Edit
            </Button>
          ) : null}
          <IconButton
            disabled={remove.isPending}
            icon={<CloseIcon />}
            label="Remove from queue"
            onClick={() =>
              remove.mutate({
                expectedRevision: item.revision,
                itemId: item.id,
              })
            }
            size="sm"
          />
        </div>
      ) : null}
    </li>
  );
};

/** Queue items the tray shows: pending ones and recently settled ones. */
export const useVisibleQueue = () => {
  const { idleSubmissions, live, missionId } = useMission();
  const now = useNow();
  const goalId = goalRequestId(missionId);
  const goal = live.queue[goalId];
  // A failed or uncertain goal stays in the tray so it can be retried.
  const goalRetryable = goal ? isRetryable(goal) : false;
  const hidden = useMemo(
    () =>
      new Set([
        ...deliveredRequestIds(Object.values(live.transcript)),
        ...(goalRetryable ? [] : [goalId]),
        ...inlineIdleSubmissions(
          idleSubmissions,
          live.queue,
          Object.values(live.transcript)
        ).map((item) => item.id),
      ]),
    [live.transcript, live.queue, idleSubmissions, goalId, goalRetryable]
  );
  return visibleQueue(Object.values(live.queue), now, hidden);
};

/** Messages waiting for delivery, above the composer. */
export const QueueTray = ({
  editingItemId,
  onBeginEdit,
  onCancelEdit,
  saving,
}: {
  editingItemId: string | null;
  onBeginEdit: (item: QueueItem) => void;
  onCancelEdit: () => void;
  saving: boolean;
}) => {
  const { live } = useMission();
  const items = useVisibleQueue();
  // The row stays while its edit is open, even after delivery hides it, so
  // the highlighted target cannot vanish under the composer.
  const editingItem =
    editingItemId === null ? undefined : live.queue[editingItemId];
  const rows =
    editingItem && !items.some((item) => item.id === editingItem.id)
      ? [...items, editingItem]
      : items;
  if (rows.length === 0) {
    return null;
  }
  return (
    <ul
      aria-label="Message queue"
      className="mx-md flex flex-col divide-y divide-border-subtle rounded-md bg-surface-raised shadow-sm"
    >
      {rows.map((item) => (
        <QueueRow
          editing={editingItemId === item.id}
          item={item}
          key={item.id}
          onBeginEdit={() => onBeginEdit(item)}
          onCancelEdit={onCancelEdit}
          saving={saving}
        />
      ))}
    </ul>
  );
};
