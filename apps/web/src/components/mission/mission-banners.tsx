"use client";

import type { Mission } from "@missions/protocol/missions";
import { PlayIcon } from "lucide-react";
import { useState } from "react";

import { useMission } from "@/components/mission/mission-context";
import { useMissionControl } from "@/components/mission/use-mission-control";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { secondsUntil } from "@/lib/format";
import type { LiveNotice } from "@/lib/live/mission-state";
import { useNow } from "@/lib/use-now";

const ERROR_TITLES: Record<string, string> = {
  environment: "Blocked on the environment",
  merge_conflict: "Merge conflict",
  rate_limited: "Rate limited",
  recovery_required: "Needs recovery",
  run_failed: "An agent run failed",
  stop_failed: "Could not stop cleanly",
};

const NOTICE_LIMIT = 3;

const ResumeButton = () => {
  const { resume, resuming } = useMissionControl();
  return (
    <Button disabled={resuming} onClick={resume} variant="primary">
      <PlayIcon aria-hidden="true" />
      {resuming ? "Resuming…" : "Resume"}
    </Button>
  );
};

const LastError = ({
  error,
  updatedAt,
}: {
  error: NonNullable<Mission["lastError"]>;
  updatedAt: string;
}) => {
  const now = useNow();
  const retryAt =
    error.retryAfterMs === null
      ? null
      : Date.parse(updatedAt) + error.retryAfterMs;
  const seconds = secondsUntil(retryAt, now);
  return (
    <Callout
      role="alert"
      title={ERROR_TITLES[error.code] ?? "Something went wrong"}
      tone={error.code === "rate_limited" ? "warning" : "danger"}
    >
      {error.message}
      {seconds > 0 ? ` Retrying in ${seconds}s.` : ""}
    </Callout>
  );
};

const StatusBanner = ({ mission }: { mission: Mission }) => {
  switch (mission.status) {
    case "paused": {
      return (
        <Callout actions={<ResumeButton />} title="Paused">
          Agents are stopped and unsent messages were cleared. Resume to
          continue from here.
        </Callout>
      );
    }
    case "interrupted": {
      return (
        <Callout actions={<ResumeButton />} title="Interrupted" tone="warning">
          The daemon stopped while agents were working. Resume to pick up where
          they left off.
        </Callout>
      );
    }
    case "stop_failed": {
      return (
        <Callout
          actions={<ResumeButton />}
          role="alert"
          title="Could not stop cleanly"
          tone="danger"
        >
          An agent did not confirm it stopped. Check the workspace before
          resuming.
        </Callout>
      );
    }
    case "failed": {
      return (
        <Callout role="alert" title="Mission failed" tone="danger">
          {mission.summary ??
            "The mission stopped after an unrecoverable error."}
        </Callout>
      );
    }
    case "completed": {
      return (
        <Callout title="Mission complete" tone="success">
          {mission.summary ?? "The Orchestrator reports the goal is met."}{" "}
          Review, commit, and pull request steps arrive in the Changes tab.
        </Callout>
      );
    }
    default: {
      return null;
    }
  }
};

const Notices = ({ notices }: { notices: readonly LiveNotice[] }) => {
  const [dismissed, setDismissed] = useState<ReadonlySet<number>>(new Set());
  const shown = notices
    .filter((notice) => notice.level !== "info" && !dismissed.has(notice.seq))
    .slice(-NOTICE_LIMIT);
  return shown.map((notice) => (
    <Callout
      key={notice.seq}
      onDismiss={() =>
        setDismissed((current) => new Set([...current, notice.seq]))
      }
      title={ERROR_TITLES[notice.code] ?? "Heads up"}
      tone={notice.level === "error" ? "danger" : "warning"}
    >
      {notice.message}
    </Callout>
  ));
};

/** Failure, pause, and completion states shown above the composer. */
export const MissionBanners = () => {
  const { live } = useMission();
  const { mission } = live;
  const notices = Object.values(live.notices).toSorted((a, b) => a.seq - b.seq);
  return (
    <div className="flex flex-col gap-md empty:hidden">
      {mission.lastError ? (
        <LastError error={mission.lastError} updatedAt={mission.updatedAt} />
      ) : null}
      <StatusBanner mission={mission} />
      <Notices notices={notices} />
    </div>
  );
};
