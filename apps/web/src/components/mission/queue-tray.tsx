"use client";

import type { QueueItem } from "@missions/protocol/missions";
import { useMemo, useState } from "react";

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
import { Textarea } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import {
  deliveredRequestIds,
  goalRequestId,
  isEditable,
  isRetryable,
  visibleQueue,
} from "@/lib/mission/queue";
import { toast } from "@/lib/toast-store";
import { useNow } from "@/lib/use-now";

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

const EDIT_OUTCOME = {
  already_sent: {
    description: "The agent already received it, so the edit was not applied.",
    title: "Already delivered",
    tone: "info",
  },
  delete_unconfirmed: {
    description:
      "The original could not be confirmed removed, so the edit was not sent and the original may still be delivered. Your draft is kept.",
    title: "Edit not sent",
    tone: "warning",
  },
} as const;

const QueueEditor = ({
  draft,
  item,
  onClose,
  onDraft,
}: {
  draft: string;
  item: QueueItem;
  onClose: () => void;
  onDraft: (draft: string) => void;
}) => {
  const editable = isEditable(item);
  const edit = useMissionCommand(
    "editQueue",
    "Could not edit the message",
    (result) => {
      if (result.outcome !== "delete_unconfirmed") {
        onClose();
      }
      if (result.outcome !== "replaced") {
        toast(EDIT_OUTCOME[result.outcome]);
      }
    }
  );
  return (
    <li className="flex flex-col gap-sm px-md py-sm">
      <Textarea
        aria-label="Edit queued message"
        onChange={(event) => onDraft(event.target.value)}
        value={draft}
      />
      {editable ? null : (
        <output className="type-caption text-warning">
          {item.state === "sent"
            ? "The agent received the original before you saved. Your draft is still here to copy."
            : "This message can no longer be edited. Your draft is still here to copy."}
        </output>
      )}
      <div className="flex justify-end gap-sm">
        <Button onClick={onClose} size="sm" variant="ghost">
          {editable ? "Cancel" : "Close"}
        </Button>
        <Button
          disabled={!(editable && draft.trim()) || edit.isPending}
          onClick={() =>
            edit.mutate({
              expectedRevision: item.revision,
              itemId: item.id,
              text: draft.trim(),
            })
          }
          size="sm"
          variant="primary"
        >
          {edit.isPending ? "Saving…" : "Save"}
        </Button>
      </div>
    </li>
  );
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
  item,
  onEdit,
}: {
  item: QueueItem;
  onEdit: () => void;
}) => {
  const editable = isEditable(item);
  const route = useRoute(item);

  const mode = useMissionCommand("queueMode", "Could not change delivery");
  const remove = useMissionCommand(
    "removeQueue",
    "Could not remove the message"
  );
  return (
    <li className="flex items-start gap-md px-md py-sm" data-state={item.state}>
      <span className="mt-2xs">
        <StateMark item={item} />
      </span>
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="type-micro text-text-tertiary">
          {route ? `${route} · ` : ""}
          {stateText(item)}
        </span>
        <span className="truncate type-caption text-text">
          {item.text ||
            item.attachments.map((attachment) => attachment.name).join(", ")}
        </span>
        {item.text && item.attachments.length ? (
          <span className="truncate type-micro text-text-tertiary">
            {item.attachments.map((attachment) => attachment.name).join(", ")}
          </span>
        ) : null}
      </div>
      {isRetryable(item) ? <RetryButton item={item} /> : null}
      {editable ? (
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
          <Button onClick={onEdit} size="sm" variant="ghost">
            Edit
          </Button>
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
  const { live, missionId } = useMission();
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
      ]),
    [live.transcript, goalId, goalRetryable]
  );
  return visibleQueue(Object.values(live.queue), now, hidden);
};

/** Messages waiting for delivery, above the composer. */
export const QueueTray = () => {
  const { live } = useMission();
  const items = useVisibleQueue();
  // Held here, not in the row, so a draft survives the row leaving the
  // visible list when the original is delivered mid-edit.
  const [editing, setEditing] = useState<{ draft: string; id: string } | null>(
    null
  );
  const editingItem = editing ? live.queue[editing.id] : undefined;
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
      {rows.map((item) =>
        editing?.id === item.id ? (
          <QueueEditor
            draft={editing.draft}
            item={item}
            key={item.id}
            onClose={() => setEditing(null)}
            onDraft={(draft) => setEditing({ draft, id: item.id })}
          />
        ) : (
          <QueueRow
            item={item}
            key={item.id}
            onEdit={() => setEditing({ draft: item.text, id: item.id })}
          />
        )
      )}
    </ul>
  );
};
