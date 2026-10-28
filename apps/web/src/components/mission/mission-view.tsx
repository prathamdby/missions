"use client";

import { useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useReducer, useState } from "react";

import { AgentConversations } from "@/components/mission/agent-conversations";
import { MissionProvider } from "@/components/mission/mission-context";
import type {
  MissionContextValue,
  PanelTab,
  TranscriptEdit,
} from "@/components/mission/mission-context";
import { MissionHeader } from "@/components/mission/mission-header";
import { RightPanel } from "@/components/mission/right-panel";
import { ConnectionBanner } from "@/components/shell/connection-banner";
import { PageHeader, PageTitle } from "@/components/shell/page-header";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { errorMessage, isApiError } from "@/lib/api/api-error";
import { agentLabels } from "@/lib/format";
import { useMissionLive } from "@/lib/live/hooks";
import { missionCapabilities } from "@/lib/mission/capabilities";
import { conversationTabs } from "@/lib/mission/conversation-tabs";
import { saveForkGoal } from "@/lib/mission/fork-draft";
import type { IdleSubmission } from "@/lib/mission/idle-send";
import { inlineIdleSubmissions } from "@/lib/mission/idle-send";
import { forkGoal } from "@/lib/mission/message-actions";
import { MessageDraft } from "@/lib/mission/message-draft";
import { useMissionCommands } from "@/lib/mission/use-mission-commands";
import { toast } from "@/lib/toast-store";
import { useMediaQuery, WIDE_QUERY } from "@/lib/use-media-query";

const MissionPlaceholder = ({ error }: { error: unknown }) => {
  const missing = isApiError(error) && error.code === "not_found";
  return (
    <div className="relative flex min-w-0 flex-1 flex-col">
      <PageHeader>
        <PageTitle>{missing ? "Mission not found" : "Mission"}</PageTitle>
      </PageHeader>
      <ConnectionBanner />
      <div className="mx-auto flex w-full max-w-chat flex-col gap-lg px-lg py-xl md:px-xl">
        {error ? (
          <Callout
            actions={
              <Button asChild variant="secondary">
                <Link href="/">New mission</Link>
              </Button>
            }
            role="alert"
            title={
              missing
                ? "This mission does not exist"
                : "Could not load this mission"
            }
            tone={missing ? "info" : "danger"}
          >
            {missing
              ? "It may have been deleted, or the link is from another machine."
              : `${errorMessage(error)} It loads automatically once the daemon is reachable.`}
          </Callout>
        ) : (
          <>
            <Skeleton className="ml-auto h-10 w-2/3" />
            <Skeleton className="w-1/3" />
            <Skeleton className="w-3/4" />
            <Skeleton className="w-1/2" />
          </>
        )}
      </div>
    </div>
  );
};

/** One mission: chat column plus details panel (docked when wide, a sheet otherwise). */
export const MissionView = ({ missionId }: { missionId: string }) => {
  const mission = useMissionLive(missionId);
  const client = useQueryClient();
  const router = useRouter();
  const wide = useMediaQuery(WIDE_QUERY);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [tab, setTab] = useState<PanelTab>("overview");
  const [idleSubmissions, setIdleSubmissions] = useState<
    Readonly<Record<string, IdleSubmission>>
  >({});
  const presentIdleSubmission = useCallback((submission: IdleSubmission) => {
    setIdleSubmissions((current) => ({
      ...current,
      [submission.id]: submission,
    }));
  }, []);
  const failIdleSubmission = useCallback((id: string) => {
    setIdleSubmissions((current) => {
      if (!current[id]) {
        return current;
      }
      return Object.fromEntries(
        Object.entries(current).filter(([key]) => key !== id)
      );
    });
  }, []);
  const [transcriptEdit, setTranscriptEdit] = useState<TranscriptEdit | null>(
    null
  );
  const [rewindSaving, setRewindSaving] = useState(false);
  const [conversations, dispatchConversation] = useReducer(conversationTabs, {
    closed: [],
    selected: null,
  });
  const selectedAgentId = conversations.selected;
  const showAgent = useCallback((agentId: string) => {
    dispatchConversation({ id: agentId, kind: "show" });
    setSheetOpen(false);
  }, []);
  const { applyLocal, error: sessionError, live, loadOlder, refresh } = mission;
  // Release local Files once the durable transcript or retry tray owns the send.
  const pendingIdle = live
    ? inlineIdleSubmissions(
        idleSubmissions,
        live.queue,
        Object.values(live.transcript)
      )
    : Object.values(idleSubmissions);
  if (pendingIdle.length < Object.keys(idleSubmissions).length) {
    setIdleSubmissions(
      Object.fromEntries(
        pendingIdle.map((submission) => [submission.id, submission])
      )
    );
  }
  const closeAgent = useCallback(
    (agentId: string) => {
      dispatchConversation({
        agents: Object.values(live?.agents ?? {}),
        id: agentId,
        kind: "close",
      });
    },
    [live?.agents]
  );

  const showPanel = useCallback(
    (next: PanelTab) => {
      setTab(next);
      if (!wide) {
        setSheetOpen(true);
      }
    },
    [wide]
  );

  const agents = live?.agents;
  const labels = useMemo(
    () => (agents ? agentLabels(Object.values(agents)) : {}),
    [agents]
  );
  const commands = useMissionCommands(client, missionId, applyLocal, refresh);
  const [draft, setDraft] = useState(() => new MessageDraft());
  void setDraft;
  const { removed } = mission;
  useEffect(() => {
    if (removed) {
      router.replace("/");
    }
  }, [removed, router]);
  const value = useMemo<MissionContextValue | null>(
    () =>
      live
        ? {
            agentLabels: labels,
            applyLocal,
            cancelTranscriptEdit: () => setTranscriptEdit(null),
            closeAgent,
            closedAgentIds: conversations.closed,
            commands,
            draft,
            failIdleSubmission,
            forkFrom: (item) => {
              const goal = forkGoal(Object.values(live.transcript), item.id);
              if (!goal) {
                return;
              }
              if (!saveForkGoal(goal)) {
                toast({
                  description:
                    "The browser blocked storage, so the new mission could not be prepared.",
                  title: "Could not fork",
                  tone: "danger",
                });
                return;
              }
              router.push("/");
            },
            idleSubmissions,
            live,
            loadOlder,
            missionId,
            presentIdleSubmission,
            refresh,
            rewindFrom: (item) => {
              if (
                rewindSaving ||
                item.kind !== "user" ||
                !missionCapabilities(live.mission.status).message
              ) {
                return;
              }
              setTranscriptEdit({
                error: null,
                itemId: item.id,
                originalText: item.text,
                requestId: item.requestId,
                seq: item.seq,
              });
            },
            rewindSaving,
            selectedAgentId,
            sessionError,
            setRewindSaving,
            setTranscriptEditError: (error) => {
              setTranscriptEdit((current) =>
                current ? { ...current, error } : current
              );
            },
            showAgent,
            showPanel,
            transcriptEdit,
          }
        : null,
    [
      applyLocal,
      commands,
      draft,
      router,
      idleSubmissions,
      presentIdleSubmission,
      failIdleSubmission,
      conversations.closed,
      closeAgent,
      labels,
      live,
      loadOlder,
      missionId,
      refresh,
      rewindSaving,
      sessionError,
      transcriptEdit,
      selectedAgentId,
      showAgent,
      showPanel,
    ]
  );

  if (!value || removed) {
    return (
      <MissionPlaceholder
        error={mission.status === "error" ? mission.error : null}
      />
    );
  }

  return (
    <MissionProvider value={value}>
      <div className="flex min-w-0 flex-1">
        <div className="relative flex min-w-0 flex-1 flex-col">
          <MissionHeader
            onTogglePanel={() => setSheetOpen(true)}
            panelToggle={!wide}
          />
          <ConnectionBanner />
          <AgentConversations />
        </div>
        {wide ? (
          <aside
            aria-label="Mission details"
            className="relative flex w-panel shrink-0 flex-col border-l border-border-subtle"
          >
            <RightPanel onTabChange={setTab} tab={tab} />
          </aside>
        ) : null}
        {wide ? null : (
          <Sheet onOpenChange={setSheetOpen} open={sheetOpen}>
            <SheetContent
              aria-describedby={undefined}
              className="h-5/6"
              side="bottom"
            >
              <SheetTitle className="sr-only">Mission details</SheetTitle>
              <div className="-mx-md flex min-h-0 flex-1 flex-col">
                <RightPanel onTabChange={setTab} tab={tab} />
              </div>
            </SheetContent>
          </Sheet>
        )}
      </div>
    </MissionProvider>
  );
};
