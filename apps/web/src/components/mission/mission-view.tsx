"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

import { ChatColumn } from "@/components/mission/chat-column";
import { MissionProvider } from "@/components/mission/mission-context";
import type { MissionContextValue } from "@/components/mission/mission-context";
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
  const wide = useMediaQuery(WIDE_QUERY);
  const [docked, setDocked] = useState(true);
  const [sheetOpen, setSheetOpen] = useState(false);
  const { applyLocal, live, prependTranscript, refresh } = mission;

  const labels = useMemo(
    () => (live ? agentLabels(Object.values(live.agents)) : {}),
    [live]
  );
  const value = useMemo<MissionContextValue | null>(
    () =>
      live
        ? {
            agentLabels: labels,
            applyLocal,
            live,
            missionId,
            prependTranscript,
            refresh,
          }
        : null,
    [applyLocal, labels, live, missionId, prependTranscript, refresh]
  );

  if (!value) {
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
            onTogglePanel={() =>
              wide ? setDocked(!docked) : setSheetOpen(true)
            }
          />
          <ConnectionBanner />
          <ChatColumn />
        </div>
        {wide && docked ? (
          <aside
            aria-label="Mission details"
            className="flex w-panel shrink-0 flex-col border-l border-border-subtle"
          >
            <RightPanel />
          </aside>
        ) : null}
        {wide ? null : (
          <Sheet onOpenChange={setSheetOpen} open={sheetOpen}>
            <SheetContent aria-describedby={undefined} side="right">
              <SheetTitle className="sr-only">Mission details</SheetTitle>
              <RightPanel />
            </SheetContent>
          </Sheet>
        )}
      </div>
    </MissionProvider>
  );
};
