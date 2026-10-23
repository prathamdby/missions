"use client";

import type { Autonomy, DeliveryMode } from "@missions/protocol/common";
import { useMutation } from "@tanstack/react-query";
import { useId, useState } from "react";
import type { KeyboardEvent, ReactNode } from "react";

import { ArrowUpIcon, AtIcon, PaperclipIcon } from "@/components/mission/icons";
import { useMission } from "@/components/mission/mission-context";
import { QueueTray, useVisibleQueue } from "@/components/mission/queue-tray";
import { reportMutationError } from "@/components/mission/report-error";
import { AutonomyChip } from "@/components/missions/autonomy-chip";
import { Textarea } from "@/components/ui/input";
import { Kbd, KbdSizeContext } from "@/components/ui/kbd";
import { Hint } from "@/components/ui/tooltip";
import { api } from "@/lib/api/endpoints";
import { useOperationIds } from "@/lib/api/use-operation";
import { nextAutonomy } from "@/lib/autonomy";
import { isMissionActive } from "@/lib/format";

const UNSUPPORTED = "Attachments and mentions are not supported yet.";

const ToolbarIcon = ({ icon, label }: { icon: ReactNode; label: string }) => (
  <button
    aria-disabled="true"
    aria-label={`${label} (not available yet)`}
    className="flex size-7 cursor-not-allowed items-center justify-center rounded-sm text-text-secondary"
    title={UNSUPPORTED}
    type="button"
  >
    {icon}
  </button>
);

const placeholderFor = (status: string) => {
  if (status === "archived") {
    return "This mission is archived";
  }
  if (status === "completed") {
    return "Start a follow-up from this mission…";
  }
  return "Reply to the orchestrator…";
};

/** Paper S22 legend under the composer while messages wait in the queue. */
const QueueHints = () => (
  <KbdSizeContext value="sm">
    <p className="flex items-center gap-sm px-card pt-xs text-xs leading-sm font-book tracking-tight text-text-tertiary">
      <Kbd>↵</Kbd>
      steer
      <span className="w-md shrink-0" />
      <Kbd>⌥</Kbd>
      <Kbd>↵</Kbd>
      queue
      <span className="flex-1" />
      Pause clears anything not yet sent.
    </p>
  </KbdSizeContext>
);

/**
 * Paper composer. Enter steers (delivered after the current tool call);
 * Alt+Enter queues (delivered when the turn ends) while agents are working.
 */
export const MissionComposer = () => {
  const { applyLocal, live, missionId, refresh } = useMission();
  const { mission } = live;
  const [text, setText] = useState("");
  const hintId = useId();
  const ops = useOperationIds();
  const working = isMissionActive(mission.status);
  const archived = mission.status === "archived";
  const queued = useVisibleQueue().length > 0;

  const send = useMutation({
    mutationFn: (input: { mode: DeliveryMode; text: string }) =>
      api.submitMessage(missionId, {
        ...input,
        operationId: ops.idFor(`${input.mode}:${input.text}`),
      }),
    onError: (error, input) => {
      ops.release(error);
      setText((current) => current || input.text);
      reportMutationError(error, refresh, "Message not sent");
    },
    onSuccess: (value) => {
      ops.settle();
      applyLocal({ kind: "queue", value });
    },
  });

  const autonomy = useMutation({
    mutationFn: (value: Autonomy) =>
      api.updateMission(missionId, {
        autonomy: value,
        expectedRevision: mission.revision,
      }),
    onError: (error) =>
      reportMutationError(error, refresh, "Could not change autonomy"),
    onSuccess: (value) => applyLocal({ kind: "mission", value }),
  });

  const submit = (mode: DeliveryMode) => {
    const trimmed = text.trim();
    if (!trimmed || archived) {
      return;
    }
    setText("");
    send.mutate({ mode, text: trimmed });
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.nativeEvent.isComposing) {
      return;
    }
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      submit(event.altKey && working ? "queue" : "steer");
    } else if (event.key === "Tab" && event.shiftKey) {
      event.preventDefault();
      autonomy.mutate(nextAutonomy(mission.autonomy));
    }
  };

  const hint = working
    ? "Enter steers now, Alt+Enter queues for the end of the turn, Shift+Enter adds a line, Shift+Tab changes autonomy."
    : "Enter sends, Shift+Enter adds a line, Shift+Tab changes autonomy.";

  return (
    <div className="flex w-full max-w-chat flex-col gap-sm">
      <QueueTray />
      <div className="flex flex-col gap-md rounded-2xl bg-surface-raised pt-lg pr-md pb-md pl-card shadow-md">
        <Textarea
          aria-describedby={hintId}
          aria-label="Message the Orchestrator"
          data-composer-input=""
          data-testid="composer-input"
          disabled={archived}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={onKeyDown}
          placeholder={placeholderFor(mission.status)}
          rows={1}
          value={text}
          variant="bare"
        />
        <span className="sr-only" id={hintId}>
          {hint}
        </span>
        <div className="-ml-sm flex items-center gap-xs">
          <ToolbarIcon icon={<PaperclipIcon />} label="Attach files" />
          <ToolbarIcon icon={<AtIcon />} label="Mention a file" />
          <AutonomyChip
            disabled={archived || autonomy.isPending}
            onChange={(value) => autonomy.mutate(value)}
            value={mission.autonomy}
          />
          <span className="flex-1" />
          <Hint label={working ? "Steer now · ⌥↵ to queue" : "Send · ↵"}>
            <button
              aria-label="Send message"
              aria-disabled={!text.trim()}
              className="flex size-7 cursor-pointer items-center justify-center rounded-full bg-accent text-on-accent transition-colors duration-fast hover:bg-accent-hover disabled:cursor-not-allowed disabled:bg-surface-overlay disabled:text-text-disabled aria-disabled:cursor-not-allowed"
              data-testid="composer-send"
              disabled={archived}
              onClick={() => submit("steer")}
              type="button"
            >
              <ArrowUpIcon className="size-3.5" />
            </button>
          </Hint>
        </div>
      </div>
      {queued && working ? <QueueHints /> : null}
    </div>
  );
};
