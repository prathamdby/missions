"use client";

import type { Mission } from "@missions/protocol/missions";
import { useId, useState } from "react";

import {
  ChatCard,
  ChatCardBody,
  ChatCardFooter,
  ChatCardHeader,
} from "@/components/mission/chat-cards";
import {
  ClockIcon,
  CloseIcon,
  FileTextIcon,
  MergeIcon,
  ShieldIcon,
  TerminalIcon,
  WarningIcon,
} from "@/components/mission/icons";
import { useMission } from "@/components/mission/mission-context";
import { IconCell } from "@/components/mission/panel-kit";
import {
  OptionText,
  optionRow,
  selectedRow,
} from "@/components/mission/question-card";
import { useMissionCommand } from "@/components/mission/use-mission-command";
import { useMissionControl } from "@/components/mission/use-mission-control";
import { Button, UnavailableButton } from "@/components/ui/button";
import { ProgressBar } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import { RadioGroup, RadioGroupItem } from "@/components/ui/selection";
import { Hint, HintTarget } from "@/components/ui/tooltip";
import {
  canResume,
  formatDuration,
  isMissionActive,
  secondsUntil,
} from "@/lib/format";
import type { LiveNotice } from "@/lib/live/mission-state";
import { missionCapabilities } from "@/lib/mission/capabilities";
import { todoProgress } from "@/lib/mission/overview";
import { useNow } from "@/lib/use-now";
import { cn } from "@/lib/utils";

const NOTICE_TITLES: Record<string, string> = {
  environment: "Blocked on the environment",
  external_change: "The workspace changed outside the mission",
  merge_conflict: "Merge conflict",
  rate_limited: "Rate limited",
  recovery_required: "Needs recovery",
  run_failed: "An agent run failed",
  stop_failed: "Could not stop cleanly",
};

const NOTICE_LIMIT = 3;
const TIME_FORMAT = new Intl.DateTimeFormat(undefined, {
  hour: "2-digit",
  minute: "2-digit",
});
const MODEL_LOCKED = "Model unavailable";

const ResumeButton = ({
  label,
  variant = "secondary",
}: {
  label: string;
  variant?: "primary" | "secondary";
}) => {
  const { resume, resuming, pending } = useMissionControl();
  return (
    <Button
      data-testid="banner-resume"
      disabled={pending}
      onClick={resume}
      variant={variant}
    >
      {resuming ? "Resuming…" : label}
    </Button>
  );
};

const focusComposer = () =>
  document.querySelector<HTMLTextAreaElement>("[data-composer-input]")?.focus();

const Countdown = ({
  retryAfterMs,
  since,
}: {
  retryAfterMs: number | null;
  since: string;
}) => {
  const now = useNow();
  if (retryAfterMs === null || retryAfterMs <= 0) {
    return null;
  }
  const start = Date.parse(since);
  const at = start + retryAfterMs;
  const seconds = secondsUntil(at, now);
  if (seconds <= 0) {
    return null;
  }
  const progress = Math.min(1, Math.max(0, (now - start) / retryAfterMs));
  return (
    <div className="flex flex-col gap-sm">
      <div className="flex items-center">
        <span className="flex-1 text-xs leading-sm font-medium tracking-tight text-text">
          Resumes on its own at {TIME_FORMAT.format(at)}
        </span>
        <span className="font-mono text-2xs leading-xs font-book text-text-tertiary">
          in {formatDuration(seconds * 1000)}
        </span>
      </div>
      <ProgressBar
        label="Time until it resumes"
        tone="muted"
        value={progress * 100}
      />
    </div>
  );
};

const SwitchWorkersButton = () => (
  <UnavailableButton reason={MODEL_LOCKED}>
    Use another model for workers
  </UnavailableButton>
);

/** Paper UL7: paused, optionally by a rate limit. */
const PausedCard = ({ mission }: { mission: Mission }) => {
  const rateLimited = mission.lastError?.code === "rate_limited";
  const interrupted = mission.status === "interrupted";
  let title = "Paused";
  if (rateLimited) {
    title = "Paused by a rate limit";
  } else if (interrupted) {
    title = "Interrupted";
  }
  const body =
    mission.lastError?.message ??
    (interrupted
      ? "The daemon stopped while agents were working. Resume to pick up where they left off."
      : "Agents stopped at a safe point. Messages that were not sent yet stay in the queue and go out after you resume.");
  return (
    <ChatCard label={title} testId="paused-card">
      <ChatCardHeader
        icon={<ClockIcon className="size-4 text-text-secondary" />}
        status={
          interrupted
            ? { label: "Interrupted", tone: "warning" }
            : { label: "Paused", tone: "muted" }
        }
      >
        {title}
      </ChatCardHeader>
      <ChatCardBody>
        <p className="text-sm leading-chat font-book tracking-tight text-text-secondary">
          {body}
        </p>
        <Countdown
          retryAfterMs={mission.lastError?.retryAfterMs ?? null}
          since={mission.updatedAt}
        />
      </ChatCardBody>
      <ChatCardFooter>
        <ResumeButton label="Resume now" />
        {rateLimited ? <SwitchWorkersButton /> : null}
        <span className="flex-1" />
        {rateLimited ? (
          <UnavailableButton reason="Not available yet" variant="ghost">
            Notify me when it resumes
          </UnavailableButton>
        ) : null}
      </ChatCardFooter>
    </ChatCard>
  );
};

/** Paper UL7 shape for a rate limit the agent is retrying through on its own. */
const RateLimitCard = ({
  notice,
  onDismiss,
}: {
  notice: LiveNotice;
  onDismiss: () => void;
}) => (
  <ChatCard label="Rate limited" testId="rate-limit-card">
    <ChatCardHeader
      icon={<ClockIcon className="size-4 text-text-secondary" />}
      status={{ label: "Retrying", tone: "muted" }}
    >
      Slowed by a rate limit
    </ChatCardHeader>
    <ChatCardBody>
      <p className="text-sm leading-chat font-book tracking-tight text-text-secondary">
        {notice.message}. The agent waits and retries on its own, so nothing is
        lost.
      </p>
      <Countdown retryAfterMs={notice.retryAfterMs} since={notice.at} />
    </ChatCardBody>
    <ChatCardFooter>
      <SwitchWorkersButton />
      <span className="flex-1" />
      <Button onClick={onDismiss} variant="ghost">
        Dismiss
      </Button>
    </ChatCardFooter>
  </ChatCard>
);

const OutputBlock = ({ text }: { text: string }) => {
  const lines = text.split("\n").filter((line) => line.trim() !== "");
  return (
    <ScrollArea asChild axis="x">
      <div className="flex flex-col gap-2xs rounded-sm bg-bg px-lg py-control ring-1 ring-border-subtle select-text ring-inset">
        {lines.map((line, index) => (
          <span
            className={cn(
              "font-mono text-2xs leading-sm whitespace-pre",
              line.startsWith("$ ") || (index > 0 && index === lines.length - 1)
                ? "text-text-tertiary"
                : "text-danger"
            )}
            // Output lines can repeat; their order is their identity.
            // oxlint-disable-next-line no-array-index-key
            key={index}
          >
            {line}
          </span>
        ))}
      </div>
    </ScrollArea>
  );
};

const RETRY_BLOCKED =
  "I fixed the environment problem the worker hit. Retry the failed step and continue.";

/** Retrying a blocked worker goes through the Orchestrator, which owns dispatch. */
const RetryBlockedButton = () => {
  const occurrence = useId();
  const retry = useMissionCommand(
    "message",
    "Could not ask for a retry",
    undefined,
    occurrence
  );
  return (
    <Button
      disabled={retry.isPending || retry.isSuccess}
      onClick={() => retry.mutate({ mode: "steer", text: RETRY_BLOCKED })}
      data-testid="blocked-retry"
      variant="primary"
    >
      Retry
    </Button>
  );
};

/** Paper V69: an agent is blocked by its environment. */
const BlockedCard = ({ mission }: { mission: Mission }) => {
  const resumable = canResume(mission.status);
  const stopFailed = mission.status === "stop_failed";
  return (
    <ChatCard label="Blocked" testId="blocked-card" tone="danger">
      <ChatCardHeader
        icon={<WarningIcon className="size-4 text-danger" />}
        status={{ label: "Blocked", tone: "danger" }}
      >
        {stopFailed
          ? "An agent did not stop cleanly"
          : "A worker is blocked by its environment"}
      </ChatCardHeader>
      <ChatCardBody>
        <OutputBlock
          text={
            mission.lastError?.message ??
            "The agent reported an environment failure."
          }
        />
        <p className="text-sm leading-chat font-book tracking-tight text-text-secondary">
          {stopFailed
            ? "Check the workspace before resuming."
            : "Fix the environment on this machine, then retry. Other agents keep their progress."}
        </p>
      </ChatCardBody>
      <ChatCardFooter>
        {resumable ? (
          <ResumeButton label="Retry" variant="primary" />
        ) : (
          <RetryBlockedButton />
        )}
        <UnavailableButton reason="Not available yet">
          <TerminalIcon className="size-3.5 text-text-secondary" />
          Open terminal in worktree
        </UnavailableButton>
        <span className="flex-1" />
        <Button onClick={focusComposer} variant="ghost">
          Tell the worker what to do
        </Button>
      </ChatCardFooter>
    </ChatCard>
  );
};

/** Paper WFC: the mission failed. */
const FailedCard = ({ mission }: { mission: Mission }) => {
  const { agentLabels, live } = useMission();
  const { items: todos } = todoProgress(live.todos, live.agents);
  const stopIndex = todos.findIndex((todo) => todo.status !== "completed");
  const title =
    stopIndex !== -1 && todos.length > 0
      ? `Mission stopped at todo ${stopIndex + 1} of ${todos.length}`
      : "Mission stopped";
  const failed = Object.values(live.assignments)
    .filter((assignment) => assignment.status === "failed")
    .toSorted((a, b) => a.createdAt.localeCompare(b.createdAt));
  const { commits } = mission.publish;
  const branch = mission.workspace?.branch ?? "the mission branch";
  return (
    <ChatCard label={title} testId="failed-card" tone="danger">
      <ChatCardHeader
        icon={<CloseIcon className="size-4 text-danger" />}
        status={{ label: "Failed", tone: "danger" }}
      >
        {title}
      </ChatCardHeader>
      <ChatCardBody>
        <p className="text-sm leading-chat font-book tracking-tight text-text-secondary">
          {mission.lastError?.message ??
            mission.summary ??
            "The mission stopped after an unrecoverable error."}
        </p>
      </ChatCardBody>
      {failed.length > 0 ? (
        <ul className="flex flex-col pb-sm">
          {failed.map((assignment) => (
            <li
              className="flex h-9 shrink-0 items-center gap-control px-card"
              key={assignment.id}
            >
              <IconCell>
                <CloseIcon className="size-3.5 text-danger" />
              </IconCell>
              <span className="min-w-0 flex-1 truncate text-sm leading-sm font-book tracking-tight text-text">
                {assignment.title}
              </span>
              <span className="text-xs leading-sm text-text-tertiary">
                {assignment.workerAgentId
                  ? (agentLabels[assignment.workerAgentId] ?? "Worker")
                  : "Worker"}
              </span>
              <span className="flex min-w-14 justify-end font-mono text-2xs leading-xs text-text-tertiary">
                {formatDuration(
                  Date.parse(assignment.updatedAt) -
                    Date.parse(assignment.createdAt)
                )}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
      <div className="flex items-center gap-control border-t border-border-subtle bg-surface px-card py-control">
        <ShieldIcon className="size-3.5 shrink-0 text-success" />
        <span className="flex-1 text-xs leading-sm font-book tracking-tight text-text-secondary">
          {commits.length > 0
            ? `${commits.length} ${commits.length === 1 ? "commit is" : "commits are"} on ${branch}. Nothing was pushed.`
            : "Nothing was committed or pushed. Changes stay in the workspace for review."}
        </span>
      </div>
      <ChatCardFooter>
        <ResumeButton
          label={stopIndex === -1 ? "Retry" : `Retry todo ${stopIndex + 1}`}
          variant="primary"
        />
        <UnavailableButton reason={MODEL_LOCKED}>
          Retry with another worker model
        </UnavailableButton>
        <UnavailableButton reason="Not available yet">
          Replan from here
        </UnavailableButton>
        <span className="flex-1" />
        <UnavailableButton reason="Not available yet" variant="ghost">
          <FileTextIcon className="size-3.5 text-text-secondary" />
          View logs
        </UnavailableButton>
      </ChatCardFooter>
    </ChatCard>
  );
};

const CONFLICT_CHOICES = [
  {
    detail:
      "The Orchestrator rebases, resolves the conflicts, and pushes again.",
    label: "Let droids resolve it (Recommended)",
    value: "droids",
  },
  {
    detail:
      "Resolve them in the worktree yourself, then tell the Orchestrator.",
    label: "I’ll resolve it myself",
    value: "myself",
  },
  {
    detail: "Keep working on the old base. The push stays rejected.",
    label: "Not now",
    value: "later",
  },
] as const;

/** Paper VTC: the push was rejected because the remote branch moved. */
const MergeConflictCard = ({
  notice,
  onDismiss,
}: {
  notice: LiveNotice;
  onDismiss: () => void;
}) => {
  const { live } = useMission();
  const [choice, setChoice] = useState<string>("droids");
  const base = live.mission.workspace?.baseRef ?? "main";
  const canMessage = missionCapabilities(live.mission.status).message;
  const steer = useMissionCommand(
    "message",
    "Could not message the Orchestrator",
    onDismiss,
    `notice:${notice.seq}`
  );
  const resolve = () =>
    steer.mutate({
      mode: "steer",
      text: `The push was rejected because the remote moved ahead. Rebase the mission branch on ${base}, resolve the conflicts, re-run the checks, and push again.`,
    });
  return (
    <ChatCard label="Merge conflict" testId="merge-conflict-card">
      <ChatCardHeader
        icon={<MergeIcon className="size-4 text-warning" />}
        status={{ label: "Needs you", tone: "warning" }}
      >
        origin moved ahead: the push was rejected
      </ChatCardHeader>
      <ChatCardBody>
        <p className="text-sm leading-chat font-book tracking-tight text-text-secondary">
          {notice.message}
        </p>
      </ChatCardBody>
      <div className="px-sm pb-sm">
        <RadioGroup
          aria-label="How to resolve the conflict"
          onValueChange={setChoice}
          value={choice}
        >
          {CONFLICT_CHOICES.map((option) => (
            <label
              className={cn(
                optionRow,
                "items-start",
                choice === option.value && selectedRow
              )}
              htmlFor={`conflict-${option.value}`}
              key={option.value}
            >
              <RadioGroupItem
                id={`conflict-${option.value}`}
                value={option.value}
              />
              <OptionText option={`${option.label} — ${option.detail}`} />
            </label>
          ))}
        </RadioGroup>
      </div>
      <ChatCardFooter>
        <span className="flex-1" />
        <Hint
          disabled={canMessage || choice !== "droids"}
          label="Resolve conflict first"
        >
          <HintTarget inactive={!canMessage && choice === "droids"}>
            <Button
              disabled={steer.isPending || (choice === "droids" && !canMessage)}
              onClick={() => (choice === "droids" ? resolve() : onDismiss())}
              variant="primary"
            >
              Continue
            </Button>
          </HintTarget>
        </Hint>
      </ChatCardFooter>
    </ChatCard>
  );
};

const NoticeCard = ({
  notice,
  onDismiss,
}: {
  notice: LiveNotice;
  onDismiss: () => void;
}) => {
  const error = notice.level === "error";
  return (
    <ChatCard
      label={NOTICE_TITLES[notice.code] ?? "Heads up"}
      tone={error ? "danger" : "warning"}
    >
      <ChatCardHeader
        icon={
          <WarningIcon
            className={cn("size-4", error ? "text-danger" : "text-warning")}
          />
        }
        status={
          error
            ? { label: "Error", tone: "danger" }
            : { label: "Heads up", tone: "warning" }
        }
      >
        {NOTICE_TITLES[notice.code] ?? "Heads up"}
      </ChatCardHeader>
      <ChatCardBody>
        <p className="text-sm leading-chat font-book tracking-tight text-text-secondary">
          {notice.message}
        </p>
      </ChatCardBody>
      <ChatCardFooter>
        <span className="flex-1" />
        <Button onClick={onDismiss} variant="ghost">
          Dismiss
        </Button>
      </ChatCardFooter>
    </ChatCard>
  );
};

const NoticeView = ({
  notice,
  onDismiss,
}: {
  notice: LiveNotice;
  onDismiss: () => void;
}) => {
  if (notice.code === "rate_limited") {
    return <RateLimitCard notice={notice} onDismiss={onDismiss} />;
  }
  if (notice.code === "merge_conflict") {
    return <MergeConflictCard notice={notice} onDismiss={onDismiss} />;
  }
  return <NoticeCard notice={notice} onDismiss={onDismiss} />;
};

/** Only the newest notice per code: retries repeat the same warning. */
const latestPerCode = (notices: readonly LiveNotice[]) => {
  const latest = new Map<string, LiveNotice>();
  for (const notice of notices) {
    latest.set(notice.code, notice);
  }
  return [...latest.values()].toSorted((a, b) => a.seq - b.seq);
};

/** Notices raised by publishing render under the finish cards that caused them. */
const PUBLISH_CODES = new Set(["merge_conflict"]);

const Notices = ({
  hideErrors,
  notices,
  publish,
}: {
  hideErrors: boolean;
  notices: readonly LiveNotice[];
  publish: boolean;
}) => {
  const [dismissed, setDismissed] = useState<ReadonlySet<number>>(new Set());
  const shown = latestPerCode(
    notices.filter(
      (notice) =>
        notice.level !== "info" &&
        PUBLISH_CODES.has(notice.code) === publish &&
        !dismissed.has(notice.seq) &&
        !(hideErrors && notice.level === "error")
    )
  ).slice(-NOTICE_LIMIT);
  return shown.map((notice) => (
    <NoticeView
      key={notice.seq}
      notice={notice}
      onDismiss={() =>
        setDismissed((current) => new Set([...current, notice.seq]))
      }
    />
  ));
};

const BLOCKING = new Set(["environment"]);

/** Paused, blocked, and failed states, inline at the end of the chat (Paper UL7, V69, VTC, WFC). */
export const MissionBanners = () => {
  const { live } = useMission();
  const { mission } = live;
  const active = isMissionActive(mission.status);
  // A rate limit only matters while agents are retrying; once the mission
  // pauses or ends the warning is stale.
  const notices = Object.values(live.notices)
    .filter((notice) => active || notice.code !== "rate_limited")
    .toSorted((a, b) => a.seq - b.seq);
  const environment = BLOCKING.has(mission.lastError?.code ?? "");
  const blocked =
    mission.status === "stop_failed" ||
    (environment && (mission.status === "interrupted" || active));
  let card = null;
  if (mission.status === "failed") {
    card = <FailedCard mission={mission} />;
  } else if (blocked) {
    card = <BlockedCard mission={mission} />;
  } else if (mission.status === "paused" || mission.status === "interrupted") {
    card = <PausedCard mission={mission} />;
  }
  return (
    <>
      <Notices hideErrors={card !== null} notices={notices} publish={false} />
      {card}
    </>
  );
};

/** Paper VTC: a rejected push, shown below the push card. */
export const PublishNotices = () => {
  const { live } = useMission();
  const notices = Object.values(live.notices).toSorted((a, b) => a.seq - b.seq);
  return <Notices hideErrors={false} notices={notices} publish />;
};
