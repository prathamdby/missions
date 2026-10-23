import type { DaemonEvent } from "@missions/protocol/events";
import type {
  Mission,
  MissionSnapshot,
  TranscriptItem,
} from "@missions/protocol/missions";

import { removeStream, reportStream } from "./connection-store";
import { openEventStream } from "./event-stream";
import type { EventStream } from "./event-stream";
import {
  applyEvents,
  applyLocal,
  hasGap,
  prependTranscript,
  rebase,
} from "./mission-state";
import type { MissionLiveState } from "./mission-state";

export type LocalEntity = Parameters<typeof applyLocal>[1];

export interface MissionStoreSnapshot {
  error: unknown;
  live: MissionLiveState | null;
  status: "error" | "loading" | "ready";
}

export interface MissionStore {
  applyLocal: (entity: LocalEntity) => void;
  prependTranscript: (
    items: readonly TranscriptItem[],
    hasMore: boolean
  ) => void;
  getSnapshot: () => MissionStoreSnapshot;
  refresh: () => Promise<boolean>;
  start: () => void;
  stop: () => void;
  subscribe: (listener: () => void) => () => void;
}

interface MissionStoreOptions {
  eventsUrl: (after: number | undefined) => string;
  fetchSnapshot: (
    missionId: string,
    signal: AbortSignal
  ) => Promise<MissionSnapshot>;
  missionId: string;
  onMission?: (mission: Mission) => void;
}

/** Events kept to replay on top of a refetched snapshot. */
const LOG_LIMIT = 2000;

/**
 * Snapshot + one SSE stream for a mission. Events are retained in a bounded
 * log, so a snapshot refetched after a resync or reconnect is rebased with
 * every newer event instead of losing them.
 */
export const createMissionStore = ({
  eventsUrl,
  fetchSnapshot,
  missionId,
  onMission,
}: MissionStoreOptions): MissionStore => {
  let state: MissionStoreSnapshot = {
    error: null,
    live: null,
    status: "loading",
  };
  const listeners = new Set<() => void>();
  let log: DaemonEvent[] = [];
  let stream: EventStream | null = null;
  let controller: AbortController | null = null;
  let running = false;
  const streamId = `mission:${missionId}`;

  const set = (patch: Partial<MissionStoreSnapshot>) => {
    const previous = state.live?.mission;
    state = { ...state, ...patch };
    if (state.live && state.live.mission !== previous) {
      onMission?.(state.live.mission);
    }
    for (const listener of listeners) {
      listener();
    }
  };

  /** Never rejects: failures land in `state.error`. */
  const load = async () => {
    controller?.abort();
    const current = new AbortController();
    controller = current;
    try {
      const snapshot = await fetchSnapshot(missionId, current.signal);
      log = log.filter((event) => event.seq > snapshot.cursor);
      set({ error: null, live: rebase(snapshot, log), status: "ready" });
      return true;
    } catch (error) {
      if (current.signal.aborted) {
        return false;
      }
      set({ error, status: state.live ? "ready" : "error" });
      return false;
    }
  };

  const remember = (events: DaemonEvent[]) => {
    log = [...log, ...events];
    if (log.length > LOG_LIMIT) {
      log = log.slice(-LOG_LIMIT);
    }
  };

  const resync = async () => {
    if (await load()) {
      stream?.restart();
    }
  };

  const openStream = () => {
    const opened = openEventStream({
      onEvents: (events) => {
        remember(events);
        if (state.live) {
          const gap = hasGap(state.live.applied, events);
          set({ live: applyEvents(state.live, events) });
          if (gap) {
            load();
          }
        }
      },
      onOpen: (reconnected) => {
        if (reconnected || !state.live) {
          load();
        }
      },
      onResync: () => {
        log = [];
        resync();
      },
      onStatus: (status) =>
        reportStream(streamId, { retryNow: () => opened.retryNow(), status }),
      url: () => eventsUrl(state.live?.applied),
    });
    stream = opened;
  };

  const begin = async () => {
    await load();
    if (running) {
      openStream();
    }
  };

  return {
    applyLocal: (entity) => {
      if (state.live) {
        set({ live: applyLocal(state.live, entity) });
      }
    },
    getSnapshot: () => state,
    prependTranscript: (items, hasMore) => {
      if (state.live) {
        set({ live: prependTranscript(state.live, items, hasMore) });
      }
    },
    refresh: load,
    start: () => {
      if (running) {
        return;
      }
      running = true;
      begin();
    },
    stop: () => {
      running = false;
      controller?.abort();
      stream?.close();
      stream = null;
      removeStream(streamId);
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
};
