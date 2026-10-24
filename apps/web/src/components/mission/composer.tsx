"use client";

import type { DeliveryMode, ExecutionMode } from "@missions/protocol/common";
import type { MissionStatus } from "@missions/protocol/missions";
import { useMutation } from "@tanstack/react-query";
import { useMemo, useState, useSyncExternalStore } from "react";
import type { KeyboardEvent, ReactNode } from "react";

import {
  ArrowUpIcon,
  AtIcon,
  PaperclipIcon,
  PauseIcon,
  PlayIcon,
  RepeatIcon,
} from "@/components/mission/icons";
import { useMission } from "@/components/mission/mission-context";
import { QueueTray } from "@/components/mission/queue-tray";
import { reportMutationError } from "@/components/mission/report-error";
import { useMissionControl } from "@/components/mission/use-mission-control";
import { ExecutionModeChip } from "@/components/missions/execution-mode-chip";
import { Textarea } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { Hint } from "@/components/ui/tooltip";
import { canResume, isMissionActive } from "@/lib/format";
import { missionCapabilities } from "@/lib/mission/capabilities";
import { composerAction } from "@/lib/mission/composer-action";
import type { ComposerAction } from "@/lib/mission/composer-action";
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

const ACTION_BUTTON =
  "flex size-7 cursor-pointer items-center justify-center rounded-full bg-accent text-on-accent transition-colors duration-fast hover:bg-accent-hover disabled:cursor-not-allowed disabled:bg-surface-overlay disabled:text-text-disabled aria-disabled:cursor-not-allowed aria-busy:bg-surface-overlay";

const actionPresentation = (action: ComposerAction, working: boolean) => {
  switch (action.kind) {
    case "pause": {
      return {
        hint: "Pause all agents at a safe point",
        icon: <PauseIcon className="size-3.5" />,
        label: "Pause mission",
      };
    }
    case "resume": {
      return {
        hint:
          action.label === "Resume"
            ? "Resume the mission"
            : "Resume from the last safe point",
        icon:
          action.label === "Resume" ? (
            <PlayIcon className="size-3.5" />
          ) : (
            <RepeatIcon className="size-3.5" />
          ),
        label: `${action.label} mission`,
      };
    }
    case "progress": {
      return {
        hint: action.label,
        icon: <Spinner label={action.label} pattern="wave" size="sm" />,
        label: action.label,
      };
    }
    default: {
      return {
        hint: working ? "Steer now" : "Send",
        icon: <ArrowUpIcon className="size-3.5" />,
        label: "Send message",
      };
    }
  }
};

/**
 * One button for the composer's current action: Send while there is text,
 * Pause while agents work and the draft is empty, Resume or Retry once
 * stopped. Only a click runs Pause or Resume; Enter only ever sends.
 */
const ComposerActionButton = ({
  onSend,
  text,
}: {
  onSend: () => void;
  text: string;
}) => {
  const { live } = useMission();
  const { status } = live.mission;
  const { control, pause, resume } = useMissionControl();
  const action = composerAction({
    agents: Object.values(live.agents),
    draft: text,
    pending: control,
    status,
  });
  const capabilities = missionCapabilities(status);
  const { hint, icon, label } = actionPresentation(action, capabilities.active);
  const inert =
    action.kind === "progress" || (action.kind === "send" && !action.enabled);
  const run = () => {
    if (action.kind === "send") {
      onSend();
    } else if (action.kind === "pause") {
      pause();
    } else if (action.kind === "resume") {
      resume();
    }
  };
  return (
    <Hint label={hint}>
      <button
        aria-busy={action.kind === "progress" || undefined}
        aria-disabled={inert}
        aria-label={label}
        className={ACTION_BUTTON}
        data-action={action.kind}
        data-testid="composer-send"
        disabled={action.kind === "send" && !capabilities.message}
        onClick={inert ? undefined : run}
        type="button"
      >
        {icon}
      </button>
    </Hint>
  );
};

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
  const working = isMissionActive(mission.status);
  const capabilities = missionCapabilities(mission.status);
  const disabled = !capabilities.message;
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
    }
  };

  return (
    <div className="flex w-full max-w-chat flex-col gap-sm">
      <QueueTray />
      <div className="flex flex-col gap-md rounded-2xl bg-surface-raised pt-lg pr-md pb-md pl-card shadow-md">
        <Textarea
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
        <div className="-ml-sm flex items-center gap-xs">
          <ToolbarIcon icon={<PaperclipIcon />} label="Attach files" />
          <ToolbarIcon icon={<AtIcon />} label="Mention a file" />
          <ExecutionModeChip
            disabled={disabled}
            onChange={(next) =>
              setModeChoice(next === effectiveMode(mission) ? null : next)
            }
            value={selectedMode}
          />
          <span className="flex-1" />
          <ComposerActionButton onSend={() => submit("steer")} text={text} />
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
    </div>
  );
};
