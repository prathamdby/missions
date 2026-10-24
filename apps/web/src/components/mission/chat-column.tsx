"use client";

import type { TranscriptItem } from "@missions/protocol/missions";
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
import { ScrollArea } from "@/components/ui/scroll-area";
import { errorMessage } from "@/lib/api/api-error";
import { useSingleFlightMutation } from "@/lib/api/use-operation";
import { formatDuration, isMissionActive } from "@/lib/format";
import {
  deliveredRequestIds,
  goalRequestId,
  showGoalBubble,
} from "@/lib/mission/queue";
import { buildTimeline } from "@/lib/mission/timeline";
import { WAITING, waitingOf } from "@/lib/mission/waiting";
import { useNow } from "@/lib/use-now";

const PAGE_SIZE = 100;
/** Within this distance of the bottom, new output keeps the view pinned. */
const STICK_THRESHOLD_PX = 96;

const EarlierMessages = ({ onLoaded }: { onLoaded: () => void }) => {
  const { loadOlder, refresh, sessionError } = useMission();
  const load = useSingleFlightMutation({
    mutationFn: async () => {
      if (!(await loadOlder(PAGE_SIZE))) {
        throw new Error(
          "Earlier messages were not loaded. Reconnect and try again."
        );
      }
    },
    onError: (error) =>
      reportMutationError(error, refresh, "Could not load earlier messages"),
    onSuccess: onLoaded,
  });
  return (
    <div className="flex flex-col items-center gap-sm">
      <Button
        disabled={load.isPending}
        onClick={() => load.mutate()}
        size="sm"
        variant="ghost"
      >
        {load.isPending ? "Loading…" : "Load earlier messages"}
      </Button>
      {load.isError ? (
        <p className="text-xs leading-sm text-danger select-text" role="alert">
          {errorMessage(sessionError ?? load.error)}
        </p>
      ) : null}
    </div>
  );
};

/** When the current turn began: the latest message to the agents, else mission start. */
const turnStart = (transcript: readonly TranscriptItem[], fallback: string) => {
  let start = fallback;
  for (const item of transcript) {
    if (
      (item.kind === "user" ||
        item.kind === "system" ||
        item.kind === "agent_message") &&
      item.createdAt > start
    ) {
      start = item.createdAt;
    }
  }
  return start;
};

/**
 * Paper QAU working line: accent loader, phase, and how long this turn has
 * run. A known waiting reason (startup, model, write access, provider retry)
 * replaces the generic phase.
 */
const WorkingLine = ({
  agentId,
  transcript,
}: {
  agentId?: string;
  transcript: readonly TranscriptItem[];
}) => {
  const { live } = useMission();
  const now = useNow();
  const agents = Object.values(live.agents).filter(
    (agent) => !agentId || agent.id === agentId
  );
  const working = agents.some(
    (agent) => agent.status === "working" || agent.status === "starting"
  );
  const waiting = agents
    .map((agent) => waitingOf(agent))
    .find((reason) => reason !== null);
  if (!((working || waiting) && isMissionActive(live.mission.status))) {
    return null;
  }
  let label =
    live.mission.status === "exploring" ? "Exploring the codebase" : "Working";
  if (waiting) {
    label = WAITING[waiting].long;
  }
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
export const ChatColumn = ({ agentId }: { agentId?: string }) => {
  const { live, missionId } = useMission();
  const worker = agentId ? live.agents[agentId]?.role === "worker" : false;
  const scroller = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);
  const preserveFrom = useRef<number | null>(null);
  const observedHeight = useRef<number | null>(null);

  // An agent message is one record shown in both participants' views.
  const transcript = useMemo(
    () =>
      Object.values(live.transcript).filter(
        (item) =>
          !agentId ||
          item.agentId === agentId ||
          (item.kind === "agent_message" &&
            (item.sender?.agentId === agentId ||
              item.recipient?.agentId === agentId))
      ),
    [agentId, live.transcript]
  );
  const entries = useMemo(
    () =>
      buildTimeline({
        assignments: worker ? [] : Object.values(live.assignments),
        permissions: Object.values(live.permissions),
        planAgentId: worker ? undefined : agentId,
        planInFlight:
          !worker &&
          !!agentId &&
          ["working", "starting"].includes(live.agents[agentId]?.status ?? ""),
        plans: worker ? [] : Object.values(live.plans),
        previews: Object.values(live.previews),
        questions: Object.values(live.questions),
        transcript,
      }).filter(
        (entry) =>
          !agentId ||
          entry.agentId === agentId ||
          entry.kind === "agent_message" ||
          (!worker &&
            (entry.agentId === null ||
              entry.kind === "permission" ||
              entry.kind === "question"))
      ),
    [
      live.assignments,
      live.agents,
      live.permissions,
      live.plans,
      live.previews,
      live.questions,
      transcript,
      agentId,
      worker,
    ]
  );
  const goalBubble =
    !worker &&
    showGoalBubble(
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
    observedHeight.current = element.scrollHeight;
    const observer = new ResizeObserver(() => {
      const height = element.scrollHeight;
      if (preserveFrom.current !== null) {
        element.scrollTop = height - preserveFrom.current;
        preserveFrom.current = null;
      } else if (pinned.current) {
        element.scrollTop = height;
      }
      observedHeight.current = height;
    });
    observer.observe(inner);
    return () => observer.disconnect();
  }, []);

  const running = isMissionActive(live.mission.status);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <ScrollArea asChild axis="y" overscroll="contain">
        <section
          aria-label="Conversation"
          className="relative min-h-0 flex-1 px-3xl max-md:px-lg"
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
            className="mx-auto flex min-h-full w-full max-w-chat min-w-0 flex-col justify-end gap-lg pt-md pb-2xl"
          >
            {live.transcriptHasMore ? (
              <EarlierMessages
                onLoaded={() => {
                  const element = scroller.current;
                  // The session applies the page before resolving loadOlder.
                  // The observer still holds the pre-page height until paint,
                  // including any output/scrolling that happened during the fetch.
                  preserveFrom.current =
                    element && observedHeight.current !== null
                      ? observedHeight.current - element.scrollTop
                      : null;
                }}
              />
            ) : null}
            {goalBubble ? (
              <UserMessage
                requestId={goalRequestId(missionId)}
                text={live.mission.goal}
              />
            ) : null}
            {goalBubble ? <WorkspaceLine /> : null}
            <Transcript entries={entries} running={running} />
            <WorkingLine agentId={agentId} transcript={transcript} />
            {worker ? null : (
              <>
                <MissionBanners />
                <FinishFlow />
                <PublishNotices />
              </>
            )}
          </div>
        </section>
      </ScrollArea>
      <div className="flex justify-center px-3xl pb-gutter max-md:px-md max-md:pb-md">
        {worker ? (
          <p className="py-lg text-xs leading-sm text-text-tertiary">
            Read-only agent conversation. Send instructions through the
            Orchestrator.
          </p>
        ) : (
          <MissionComposer />
        )}
      </div>
    </div>
  );
};
