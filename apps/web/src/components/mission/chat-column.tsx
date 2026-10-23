"use client";

import type { TranscriptItem } from "@missions/protocol/missions";
import { useMutation } from "@tanstack/react-query";
import { useEffect, useMemo, useRef } from "react";

import { MissionComposer } from "@/components/mission/composer";
import { FinishFlow } from "@/components/mission/finish-flow";
import {
  MissionBanners,
  PublishNotices,
} from "@/components/mission/mission-banners";
import { useMission } from "@/components/mission/mission-context";
import { DotLoader } from "@/components/mission/panel-kit";
import { reportMutationError } from "@/components/mission/report-error";
import {
  Transcript,
  UserMessage,
  WorkspaceLine,
} from "@/components/mission/transcript";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api/endpoints";
import { formatDuration, isMissionActive } from "@/lib/format";
import { deliveredRequestIds, showGoalBubble } from "@/lib/mission/queue";
import { buildTimeline } from "@/lib/mission/timeline";
import { useNow } from "@/lib/use-now";

const PAGE_SIZE = 100;
/** Within this distance of the bottom, new output keeps the view pinned. */
const STICK_THRESHOLD_PX = 96;

const EarlierMessages = ({ onLoaded }: { onLoaded: () => void }) => {
  const { live, missionId, prependTranscript, refresh } = useMission();
  const oldest = Math.min(
    ...Object.values(live.transcript).map((item) => item.seq)
  );
  const load = useMutation({
    mutationFn: () => api.missionTranscript(missionId, oldest, PAGE_SIZE),
    onError: (error) =>
      reportMutationError(error, refresh, "Could not load earlier messages"),
    onSuccess: (page) => {
      onLoaded();
      prependTranscript(page.items, page.nextCursor !== null);
    },
  });
  return (
    <div className="flex justify-center">
      <Button
        disabled={load.isPending}
        onClick={() => load.mutate()}
        size="sm"
        variant="ghost"
      >
        {load.isPending ? "Loading…" : "Load earlier messages"}
      </Button>
    </div>
  );
};

/** When the current turn began: the latest message to the agents, else mission start. */
const turnStart = (transcript: readonly TranscriptItem[], fallback: string) => {
  let start = fallback;
  for (const item of transcript) {
    if (
      (item.kind === "user" || item.kind === "system") &&
      item.createdAt > start
    ) {
      start = item.createdAt;
    }
  }
  return start;
};

/** Paper QAU working line: accent loader, phase, and how long this turn has run. */
const WorkingLine = ({
  transcript,
}: {
  transcript: readonly TranscriptItem[];
}) => {
  const { live } = useMission();
  const now = useNow();
  const working = Object.values(live.agents).some(
    (agent) => agent.status === "working"
  );
  if (!(working && isMissionActive(live.mission.status))) {
    return null;
  }
  const label =
    live.mission.status === "exploring" ? "Exploring the codebase" : "Working";
  const started = Date.parse(turnStart(transcript, live.mission.createdAt));
  return (
    <div className="flex h-2xl shrink-0 items-center gap-control">
      <DotLoader label="Agents working" tone="accent" />
      <span className="text-sm leading-sm font-medium tracking-tight text-text-secondary">
        {label}
      </span>
      <span className="font-mono text-2xs leading-xs font-book text-text-tertiary">
        {formatDuration(Math.max(0, now - started))}
      </span>
    </div>
  );
};

/** Paper FQQ chat column: transcript, inline state cards, and the composer. */
export const ChatColumn = () => {
  const { live, missionId } = useMission();
  const scroller = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);
  const preserveFrom = useRef<number | null>(null);

  const transcript = useMemo(
    () => Object.values(live.transcript),
    [live.transcript]
  );
  const entries = useMemo(
    () =>
      buildTimeline({
        assignments: Object.values(live.assignments),
        permissions: Object.values(live.permissions),
        plans: Object.values(live.plans),
        previews: Object.values(live.previews),
        questions: Object.values(live.questions),
        transcript,
      }),
    [
      live.assignments,
      live.permissions,
      live.plans,
      live.previews,
      live.questions,
      transcript,
    ]
  );
  const goalBubble = showGoalBubble(
    missionId,
    deliveredRequestIds(transcript),
    live.transcriptHasMore
  );

  // Every height change (new output, cards that load later, older pages
  // prepended) arrives here before paint: keep the bottom pinned, or keep the
  // reader's place when earlier messages load above.
  useEffect(() => {
    const element = scroller.current;
    const inner = content.current;
    if (!(element && inner)) {
      return;
    }
    const observer = new ResizeObserver(() => {
      if (preserveFrom.current !== null) {
        element.scrollTop = element.scrollHeight - preserveFrom.current;
        preserveFrom.current = null;
      } else if (pinned.current) {
        element.scrollTop = element.scrollHeight;
      }
    });
    observer.observe(inner);
    return () => observer.disconnect();
  }, []);

  const running = isMissionActive(live.mission.status);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div
        className="min-h-0 flex-1 overflow-y-auto px-3xl max-md:px-lg"
        onScroll={(event) => {
          const element = event.currentTarget;
          pinned.current =
            element.scrollHeight - element.scrollTop - element.clientHeight <
            STICK_THRESHOLD_PX;
        }}
        ref={scroller}
      >
        <div
          aria-live="polite"
          aria-relevant="additions"
          ref={content}
          className="mx-auto flex min-h-full w-full max-w-chat min-w-0 flex-col justify-end gap-section pt-section pb-2xl max-md:pt-xl"
        >
          {live.transcriptHasMore ? (
            <EarlierMessages
              onLoaded={() => {
                const element = scroller.current;
                preserveFrom.current = element
                  ? element.scrollHeight - element.scrollTop
                  : null;
              }}
            />
          ) : null}
          {goalBubble ? <UserMessage text={live.mission.goal} /> : null}
          {goalBubble ? <WorkspaceLine /> : null}
          <Transcript entries={entries} running={running} />
          <WorkingLine transcript={transcript} />
          <MissionBanners />
          <FinishFlow />
          <PublishNotices />
        </div>
      </div>
      <div className="flex justify-center px-3xl pb-gutter max-md:px-md max-md:pb-md">
        <MissionComposer />
      </div>
    </div>
  );
};
