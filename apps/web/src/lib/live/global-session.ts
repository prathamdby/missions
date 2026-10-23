import type { QueryClient } from "@tanstack/react-query";

import { removeStream, reportStream } from "./connection-store";
import { openEventStream } from "./event-stream";
import type { EventStream, OpenEventStream } from "./event-stream";
import { applyGlobalEvent, recoverQueryResources } from "./global-cache";
import { hasGap } from "./mission-state";

interface GlobalSessionOptions {
  client: QueryClient;
  eventsUrl: (after: number | undefined) => string;
  openStream?: OpenEventStream;
}

/** One disposable global stream, with complete read recovery on any loss of continuity. */
export const startGlobalSession = ({
  client,
  eventsUrl,
  openStream = openEventStream,
}: GlobalSessionOptions): (() => void) => {
  let closed = false;
  let lastSeq: number | undefined;
  let stream: EventStream | null = null;
  stream = openStream({
    onEvents: (received) => {
      if (closed) {
        return;
      }
      const events = received
        .filter((event) => event.missionId === null)
        .toSorted((a, b) => a.seq - b.seq);
      const gap = hasGap(lastSeq ?? (events[0]?.seq ?? 1) - 1, events);
      for (const event of events) {
        if (lastSeq === undefined || event.seq > lastSeq) {
          lastSeq = event.seq;
          applyGlobalEvent(client, event);
        }
      }
      if (gap) {
        recoverQueryResources(client);
      }
    },
    onOpen: () => {
      // Also closes the read/subscribe race on the very first successful open.
      if (!closed) {
        recoverQueryResources(client);
      }
    },
    onResync: () => {
      if (!closed) {
        lastSeq = undefined;
        recoverQueryResources(client);
        stream?.restart();
      }
    },
    onStatus: (status) => {
      if (!closed) {
        reportStream("global", { retryNow: () => stream?.retryNow(), status });
      }
    },
    url: () => eventsUrl(lastSeq),
  });
  return () => {
    closed = true;
    stream?.close();
    removeStream("global");
  };
};
