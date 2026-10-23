"use client";

import { routes } from "@missions/protocol/routes";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";

import { proxyUrl } from "@/lib/api/client";
import { queryKeys } from "@/lib/api/query-keys";
import { removeStream, reportStream } from "@/lib/live/connection-store";
import { openEventStream } from "@/lib/live/event-stream";
import { applyGlobalEvent } from "@/lib/live/global-cache";

const STREAM_ID = "global";

/** Keeps projects, clone jobs, and settings live for the whole app. */
export const GlobalLive = () => {
  const client = useQueryClient();

  useEffect(() => {
    let lastSeq: number | undefined;
    const refreshAll = () => {
      for (const queryKey of [
        queryKeys.projects,
        queryKeys.settings,
        queryKeys.missions,
        queryKeys.connection,
        queryKeys.githubAuth,
      ]) {
        client.invalidateQueries({ queryKey });
      }
    };
    const stream = openEventStream({
      onEvents: (events) => {
        for (const event of events.toSorted((a, b) => a.seq - b.seq)) {
          if (lastSeq === undefined || event.seq > lastSeq) {
            lastSeq = event.seq;
            applyGlobalEvent(client, event);
          }
        }
      },
      onOpen: (reconnected) => {
        if (reconnected) {
          refreshAll();
        }
      },
      onResync: () => {
        lastSeq = undefined;
        refreshAll();
        stream.restart();
      },
      onStatus: (status) =>
        reportStream(STREAM_ID, { retryNow: () => stream.retryNow(), status }),
      url: () => proxyUrl(routes.events(), { after: lastSeq }),
    });
    return () => {
      stream.close();
      removeStream(STREAM_ID);
    };
  }, [client]);

  return null;
};
