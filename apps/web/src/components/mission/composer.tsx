"use client";

import type { DeliveryMode, ExecutionMode } from "@missions/protocol/common";
import type { MissionStatus } from "@missions/protocol/missions";
import { useMutation } from "@tanstack/react-query";
import { useId, useMemo, useState, useSyncExternalStore } from "react";
import type { KeyboardEvent, ReactNode } from "react";

import { ArrowUpIcon, AtIcon, PaperclipIcon } from "@/components/mission/icons";
import { useMission } from "@/components/mission/mission-context";
import { QueueTray, useVisibleQueue } from "@/components/mission/queue-tray";
import { reportMutationError } from "@/components/mission/report-error";
import { useMissionCommand } from "@/components/mission/use-mission-command";
import { AutonomyChip } from "@/components/missions/autonomy-chip";
import { ExecutionModeChip } from "@/components/missions/execution-mode-chip";
import { Textarea } from "@/components/ui/input";
import { Kbd, KbdSizeContext } from "@/components/ui/kbd";
import { Hint } from "@/components/ui/tooltip";
import { nextAutonomy } from "@/lib/autonomy";
import { canResume, isMissionActive } from "@/lib/format";
import { missionCapabilities } from "@/lib/mission/capabilities";
import {
  effectiveMode,
  modeStatus,
  requestedMode,
} from "@/lib/mission/execution-mode";
import { MessageDraft } from "@/lib/mission/message-draft";
import type { MessageDelivery } from "@/lib/mission/message-draft";
import { markReceipt, markSubmit } from "@/lib/perf-marks";

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

const placeholderFor = (status: MissionStatus) => {
  if (status === "archived") {
    return "This mission is archived";
  }
  if (status === "completed") {
    return "Start a follow-up from this mission…";
  }
  if (canResume(status)) {
    return "Resume the mission to send a message…";
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
  const { commands, live, refresh } = useMission();
  const { mission } = live;
  const draft = useMemo(() => new MessageDraft(), []);
  const text = useSyncExternalStore(
    draft.subscribe,
    draft.snapshot,
    draft.snapshot
  );
  const hintId = useId();
  const working = isMissionActive(mission.status);
  const capabilities = missionCapabilities(mission.status);
  const disabled = !capabilities.message;
  const queued = useVisibleQueue().length > 0;
  // Null follows the mission's mode; a pick applies to the next message only.
  const [modeChoice, setModeChoice] = useState<ExecutionMode | null>(null);
  const selectedMode = modeChoice ?? effectiveMode(mission);
  const status = modeStatus(mission);

  // Not single-flight: a second message typed while the first is in flight
  // is a separate intent and must not be dropped.
  const send = useMutation({
    mutationFn: (delivery: MessageDelivery) =>
      commands.run("message", delivery.input, delivery.occurrence),
    onError: (error, delivery) => {
      draft.restore(delivery);
      if (delivery.input.executionMode) {
        setModeChoice(delivery.input.executionMode);
      }
      return reportMutationError(error, refresh, "Message not sent");
    },
    onSuccess: (item, delivery) => markReceipt(item.id, delivery.occurrence),
  });

  const autonomy = useMissionCommand("update", "Could not change autonomy");
  const changeAutonomy = (value: typeof mission.autonomy) =>
    autonomy.mutate({ autonomy: value, expectedRevision: mission.revision });

  const submit = (mode: DeliveryMode) => {
    if (disabled) {
      return;
    }
    const delivery = draft.take(mode, requestedMode(mission, selectedMode));
    if (delivery) {
      markSubmit(delivery.occurrence);
      setModeChoice(null);
      send.mutate(delivery);
    }
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
      if (capabilities.update) {
        changeAutonomy(nextAutonomy(mission.autonomy));
      }
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
          disabled={mission.status === "archived"}
          onChange={(event) => draft.change(event.target.value)}
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
            disabled={!capabilities.update || autonomy.isPending}
            onChange={changeAutonomy}
            value={mission.autonomy}
          />
          <ExecutionModeChip
            disabled={disabled}
            onChange={(next) =>
              setModeChoice(next === effectiveMode(mission) ? null : next)
            }
            value={selectedMode}
          />
          <span className="flex-1" />
          <Hint label={working ? "Steer now · ⌥↵ to queue" : "Send · ↵"}>
            <button
              aria-label="Send message"
              aria-disabled={!text.trim()}
              className="flex size-7 cursor-pointer items-center justify-center rounded-full bg-accent text-on-accent transition-colors duration-fast hover:bg-accent-hover disabled:cursor-not-allowed disabled:bg-surface-overlay disabled:text-text-disabled aria-disabled:cursor-not-allowed"
              data-testid="composer-send"
              disabled={disabled}
              onClick={() => submit("steer")}
              type="button"
            >
              <ArrowUpIcon className="size-3.5" />
            </button>
          </Hint>
        </div>
      </div>
      {status ? (
        <p
          className="px-card text-xs leading-sm font-book tracking-tight text-info md:hidden"
          data-testid="mode-status"
        >
          {status}
        </p>
      ) : null}
      {queued && working ? <QueueHints /> : null}
    </div>
  );
};
