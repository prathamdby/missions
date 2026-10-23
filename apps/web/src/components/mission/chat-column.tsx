"use client";

import { useMutation } from "@tanstack/react-query";
import { useLayoutEffect, useMemo, useRef } from "react";

import { MissionComposer } from "@/components/mission/composer";
import { MissionBanners } from "@/components/mission/mission-banners";
import { useMission } from "@/components/mission/mission-context";
import { reportMutationError } from "@/components/mission/report-error";
import { Transcript } from "@/components/mission/transcript";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { api } from "@/lib/api/endpoints";
import { isMissionActive } from "@/lib/format";
import { buildTimeline } from "@/lib/mission/timeline";

const PAGE_SIZE = 100;
/** Within this distance of the bottom, new output keeps the view pinned. */
const STICK_THRESHOLD_PX = 96;

const EarlierMessages = ({ onLoaded }: { onLoaded: () => void }) => {
  const { live, missionId, refresh } = useMission();
  const { prependTranscript } = useMission();
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

const WorkingLine = () => {
  const { agentLabels, live } = useMission();
  const working = Object.values(live.agents).filter(
    (agent) => agent.status === "working"
  );
  if (working.length === 0 || !isMissionActive(live.mission.status)) {
    return null;
  }
  const names = working
    .map((agent) => agentLabels[agent.id] ?? agent.title)
    .join(", ");
  return (
    <p className="flex items-center gap-md type-caption text-text-tertiary">
      <Spinner label="Agents working" size="sm" />
      Working · {names}
    </p>
  );
};

/** Transcript, banners, and composer. Stays pinned to the bottom while you are there. */
export const ChatColumn = () => {
  const { live } = useMission();
  const scroller = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);
  const preserveFrom = useRef<number | null>(null);

  const entries = useMemo(
    () =>
      buildTimeline({
        permissions: Object.values(live.permissions),
        plans: Object.values(live.plans),
        previews: Object.values(live.previews),
        questions: Object.values(live.questions),
        transcript: Object.values(live.transcript),
      }),
    [
      live.permissions,
      live.plans,
      live.previews,
      live.questions,
      live.transcript,
    ]
  );

  useLayoutEffect(() => {
    const element = scroller.current;
    if (!element) {
      return;
    }
    if (preserveFrom.current !== null) {
      element.scrollTop = element.scrollHeight - preserveFrom.current;
      preserveFrom.current = null;
    } else if (pinned.current && entries.length > 0) {
      element.scrollTop = element.scrollHeight;
    }
  }, [entries]);

  const running = isMissionActive(live.mission.status);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div
        className="min-h-0 flex-1 overflow-y-auto"
        onScroll={(event) => {
          const element = event.currentTarget;
          pinned.current =
            element.scrollHeight - element.scrollTop - element.clientHeight <
            STICK_THRESHOLD_PX;
        }}
        ref={scroller}
      >
        <div className="mx-auto flex w-full max-w-chat flex-col gap-lg px-lg py-xl md:px-xl">
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
          <div className="ml-auto max-w-prose rounded-lg bg-surface-raised px-lg py-md type-body break-words whitespace-pre-wrap text-text">
            {live.mission.goal}
          </div>
          <Transcript entries={entries} running={running} />
          <WorkingLine />
        </div>
      </div>
      <div className="mx-auto flex w-full max-w-chat flex-col gap-md px-lg pb-lg md:px-xl">
        <MissionBanners />
        <MissionComposer />
      </div>
    </div>
  );
};
