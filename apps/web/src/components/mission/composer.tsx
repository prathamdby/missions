"use client";

import type { DeliveryMode } from "@missions/protocol/common";
import type { MissionStatus } from "@missions/protocol/missions";
import { useMemo, useSyncExternalStore } from "react";

import { ComposerField } from "@/components/composer/composer-field";
import {
  ArrowUpIcon,
  PauseIcon,
  PlayIcon,
  RepeatIcon,
} from "@/components/mission/icons";
import { useMission } from "@/components/mission/mission-context";
import { QueueTray } from "@/components/mission/queue-tray";
import { useMissionControl } from "@/components/mission/use-mission-control";
import { useSendMessage } from "@/components/mission/use-send-message";
import { Spinner } from "@/components/ui/spinner";
import { Hint } from "@/components/ui/tooltip";
import { canResume } from "@/lib/format";
import { missionCapabilities } from "@/lib/mission/capabilities";
import { composerAction } from "@/lib/mission/composer-action";
import type { ComposerAction } from "@/lib/mission/composer-action";
import { modeStatus } from "@/lib/mission/execution-mode";
import { orchestratorTurnRunning } from "@/lib/mission/idle-send";
import { MessageDraft } from "@/lib/mission/message-draft";

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
        hint: "Pause all agents",
        icon: <PauseIcon className="size-3.5" />,
        label: "Pause mission",
      };
    }
    case "resume": {
      return {
        hint:
          action.label === "Resume"
            ? "Resume the mission"
            : "Resume from last checkpoint",
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
  hasDraft,
  ready,
}: {
  ready: boolean;
  onSend: () => void;
  hasDraft: boolean;
}) => {
  const { live } = useMission();
  const { status } = live.mission;
  const { control, pause, resume } = useMissionControl();
  const action = composerAction({
    agents: Object.values(live.agents),
    hasDraft,
    pending: control,
    status,
  });
  const capabilities = missionCapabilities(status);
  const { hint, icon, label } = actionPresentation(
    action,
    orchestratorTurnRunning(status, Object.values(live.agents))
  );
  const inert =
    action.kind === "progress" ||
    (action.kind === "send" && (!action.enabled || !ready));
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
export const MissionComposer = ({ onSend }: { onSend: () => void }) => {
  const { live } = useMission();
  const { mission } = live;
  const draft = useMemo(() => new MessageDraft(), []);
  const text = useSyncExternalStore(
    draft.subscribe,
    draft.snapshot,
    draft.snapshot
  );
  const attachments = useSyncExternalStore(
    draft.subscribe,
    draft.attachmentSnapshot,
    draft.attachmentSnapshot
  );
  const { disabled, send, working } = useSendMessage({
    onError: (delivery) => draft.restore(delivery),
    onSend,
  });
  const status = modeStatus(mission);

  const submit = (mode: DeliveryMode) => {
    if (disabled) {
      return;
    }
    const delivery = draft.take(mode);
    if (delivery) {
      void send(delivery);
    }
  };

  return (
    <div className="flex w-full max-w-chat flex-col gap-sm">
      <QueueTray />
      <ComposerField
        action={
          <ComposerActionButton
            onSend={() => submit("steer")}
            ready={draft.uploadsReady()}
            hasDraft={text.trim().length > 0 || attachments.length > 0}
          />
        }
        disabled={mission.status === "archived"}
        draft={draft}
        label="Message the Orchestrator"
        onSubmit={(mode) =>
          submit(mode === "queue" && working ? "queue" : "steer")
        }
        placeholder={placeholderFor(mission.status)}
        scope={{ id: mission.id, kind: "mission" }}
        size="touch"
        testId="composer-input"
      />
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
