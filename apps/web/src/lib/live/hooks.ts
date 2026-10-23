"use client";

import type { Mission, MissionSummary } from "@missions/protocol/missions";
import { routes } from "@missions/protocol/routes";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useSyncExternalStore } from "react";

import { proxyUrl } from "@/lib/api/client";
import { api } from "@/lib/api/endpoints";
import { queryKeys } from "@/lib/api/query-keys";
import {
  getConnection,
  getServerConnection,
  retryAllStreams,
  subscribeConnection,
} from "@/lib/live/connection-store";
import { createMissionStore } from "@/lib/live/mission-store";

/** Live mission state. Remount (key by id) to switch missions. */
export const useMissionLive = (missionId: string) => {
  const client = useQueryClient();
  const store = useMemo(
    () =>
      createMissionStore({
        eventsUrl: (after) => proxyUrl(routes.events(), { after, missionId }),
        fetchSnapshot: api.missionSnapshot,
        missionId,
        onMission: (mission: Mission) => {
          client.setQueryData<MissionSummary[]>(queryKeys.missions, (list) =>
            list?.map((entry) =>
              entry.id === mission.id
                ? {
                    ...entry,
                    status: mission.status,
                    title: mission.title,
                    updatedAt: mission.updatedAt,
                  }
                : entry
            )
          );
        },
      }),
    [client, missionId]
  );

  useEffect(() => {
    store.start();
    return () => store.stop();
  }, [store]);

  const snapshot = useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    store.getSnapshot
  );
  return {
    ...snapshot,
    applyLocal: store.applyLocal,
    prependTranscript: store.prependTranscript,
    refresh: store.refresh,
  };
};

export const useConnection = () => {
  const snapshot = useSyncExternalStore(
    subscribeConnection,
    getConnection,
    getServerConnection
  );
  return { ...snapshot, retryNow: retryAllStreams };
};
