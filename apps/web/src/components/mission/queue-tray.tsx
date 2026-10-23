"use client";

import type { QueueItem } from "@missions/protocol/missions";
import { useMutation } from "@tanstack/react-query";
import {
  CheckIcon,
  ChevronRightIcon,
  ClockIcon,
  TriangleAlertIcon,
  XIcon,
} from "lucide-react";
import { useState } from "react";

import { useMission } from "@/components/mission/mission-context";
import { reportMutationError } from "@/components/mission/report-error";
import { Button, IconButton } from "@/components/ui/button";
import { Textarea } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { api } from "@/lib/api/endpoints";
import { useOperationIds } from "@/lib/api/use-operation";
import { isEditable, visibleQueue } from "@/lib/mission/queue";
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
        <CheckIcon
          aria-label="Sent"
          className="size-3.5 shrink-0 text-success"
        />
      );
    }
    case "failed":
    case "unknown": {
      return (
        <TriangleAlertIcon
          aria-hidden="true"
          className="size-3.5 shrink-0 text-warning"
        />
      );
    }
    case "queued": {
      return item.mode === "steer" ? (
        <ChevronRightIcon
          aria-hidden="true"
          className="size-3.5 shrink-0 text-text-tertiary"
        />
      ) : (
        <ClockIcon
          aria-hidden="true"
          className="size-3.5 shrink-0 text-text-tertiary"
        />
      );
    }
    default: {
      return (
        <XIcon
          aria-hidden="true"
          className="size-3.5 shrink-0 text-text-tertiary"
        />
      );
    }
  }
};

const stateText = (item: QueueItem) => {
  switch (item.state) {
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
      return item.error ? `Failed: ${item.error}` : "Failed to send";
    }
    case "unknown": {
      return "Delivery unconfirmed. It may still arrive.";
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
      "The original could not be confirmed removed and may still be delivered.",
    title: "Edit sent, original may arrive too",
    tone: "warning",
  },
} as const;

const QueueRow = ({ item }: { item: QueueItem }) => {
  const { applyLocal, missionId, refresh } = useMission();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(item.text);
  const ops = useOperationIds();
  const editable = isEditable(item);

  const mode = useMutation({
    mutationFn: () =>
      api.changeQueueMode(missionId, item.id, {
        expectedRevision: item.revision,
        mode: item.mode === "steer" ? "queue" : "steer",
      }),
    onError: (error) =>
      reportMutationError(error, refresh, "Could not change delivery"),
    onSuccess: (value) => applyLocal({ kind: "queue", value }),
  });

  const remove = useMutation({
    mutationFn: () => api.removeQueueItem(missionId, item.id, item.revision),
    onError: (error) =>
      reportMutationError(error, refresh, "Could not remove the message"),
    onSuccess: (value) => applyLocal({ kind: "queue", value }),
  });

  const edit = useMutation({
    mutationFn: (text: string) =>
      api.editQueueItem(missionId, item.id, {
        expectedRevision: item.revision,
        operationId: ops.idFor(text),
        text,
      }),
    onError: (error) =>
      reportMutationError(error, refresh, "Could not edit the message"),
    onSuccess: (result) => {
      ops.settle();
      setEditing(false);
      if (result.outcome !== "replaced") {
        toast(EDIT_OUTCOME[result.outcome]);
      }
    },
  });

  if (editing) {
    return (
      <li className="flex flex-col gap-sm px-md py-sm">
        <Textarea
          aria-label="Edit queued message"
          onChange={(event) => setDraft(event.target.value)}
          value={draft}
        />
        <div className="flex justify-end gap-sm">
          <Button onClick={() => setEditing(false)} size="sm" variant="ghost">
            Cancel
          </Button>
          <Button
            disabled={!draft.trim() || edit.isPending}
            onClick={() => edit.mutate(draft.trim())}
            size="sm"
            variant="primary"
          >
            {edit.isPending ? "Saving…" : "Save"}
          </Button>
        </div>
      </li>
    );
  }

  return (
    <li className="flex items-start gap-md px-md py-sm">
      <span className="mt-2xs">
        <StateMark item={item} />
      </span>
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="type-micro text-text-tertiary">{stateText(item)}</span>
        <span className="truncate type-caption text-text">{item.text}</span>
      </div>
      {editable ? (
        <div className="flex shrink-0 items-center gap-2xs">
          <Button
            disabled={mode.isPending}
            onClick={() => mode.mutate()}
            size="sm"
            variant="ghost"
          >
            {item.mode === "steer" ? "Queue instead" : "Steer instead"}
          </Button>
          <Button
            onClick={() => {
              setDraft(item.text);
              setEditing(true);
            }}
            size="sm"
            variant="ghost"
          >
            Edit
          </Button>
          <IconButton
            disabled={remove.isPending}
            icon={<XIcon />}
            label="Remove from queue"
            onClick={() => remove.mutate()}
            size="sm"
          />
        </div>
      ) : null}
    </li>
  );
};

/** Messages waiting for delivery, above the composer. */
export const QueueTray = () => {
  const { live } = useMission();
  const now = useNow();
  const items = visibleQueue(Object.values(live.queue), now);
  if (items.length === 0) {
    return null;
  }
  return (
    <ul
      aria-label="Message queue"
      className="mx-md flex flex-col divide-y divide-border-subtle rounded-md bg-surface-raised shadow-sm"
    >
      {items.map((item) => (
        <QueueRow item={item} key={item.id} />
      ))}
    </ul>
  );
};
