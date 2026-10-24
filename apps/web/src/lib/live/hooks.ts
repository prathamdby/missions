"use client";

import type { TranscriptItem } from "@missions/protocol/missions";
import { routes } from "@missions/protocol/routes";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useSyncExternalStore } from "react";

import { isApiError } from "@/lib/api/api-error";
import { proxyUrl } from "@/lib/api/client";
import { api } from "@/lib/api/endpoints";
import {
  getConnection,
  getServerConnection,
  retryAllStreams,
  subscribeConnection,
} from "@/lib/live/connection-store";
import {
  applyMissionEvent,
  invalidateMissionResources,
  isMissionRemoved,
  onMissionRemoved,
  removeMission,
  upsertMissionSummary,
} from "@/lib/live/global-cache";
import { createMissionStore } from "@/lib/live/mission-store";
import type { LocalEntity } from "@/lib/live/mission-store";

/** Live mission state. Remount (key by id) to switch missions. */
export const useMissionLive = (missionId: string) => {
  const client = useQueryClient();
  const store = useMemo(
    () =>
      createMissionStore({
        eventsUrl: (after) => proxyUrl(routes.events(), { after, missionId }),
        fetchSnapshot: api.missionSnapshot,
        fetchTranscript: api.missionTranscript,
        isMissing: (error) => isApiError(error) && error.code === "not_found",
        missionId,
        onEvents: (events) => {
          for (const event of events) {
            applyMissionEvent(client, event);
          }
        },
        onMissing: () => removeMission(client, missionId),
        onMission: (mission) => {
          upsertMissionSummary(client, mission);
        },
        onReconnect: () => invalidateMissionResources(client, missionId),
      }),
    [client, missionId]
  );

  useEffect(() => {
    if (isMissionRemoved(client, missionId)) {
      store.remove();
      return;
    }
    const unsubscribe = onMissionRemoved(client, (removed) => {
      if (removed === missionId) {
        store.remove();
      }
    });
    store.start();
    return () => {
      unsubscribe();
      store.stop();
    };
  }, [client, missionId, store]);

  const snapshot = useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    store.getSnapshot
  );
  const actions = useMemo(
    () => ({
      applyLocal: (entity: LocalEntity) =>
        store.applyLocal(entity, snapshot.generation),
      loadOlder: (limit?: number) =>
        store.loadOlder(limit, snapshot.generation),
      prependTranscript: (items: readonly TranscriptItem[], hasMore: boolean) =>
        store.prependTranscript(items, hasMore, snapshot.generation),
      refresh: () => store.refresh(snapshot.generation),
    }),
    [store, snapshot.generation]
  );
  return {
    ...snapshot,
    ...actions,
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
