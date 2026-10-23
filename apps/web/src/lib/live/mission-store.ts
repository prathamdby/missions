import type { DaemonEvent } from "@missions/protocol/events";
import type {
  Mission,
  MissionSnapshot,
  TranscriptItem,
} from "@missions/protocol/missions";

import { backoffDelay } from "./backoff";
import { removeStream, reportStream } from "./connection-store";
import { openEventStream } from "./event-stream";
import type { EventStream, OpenEventStream } from "./event-stream";
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
  generation: number;
  live: MissionLiveState | null;
  status: "error" | "loading" | "ready";
}

export interface MissionStore {
  applyLocal: (entity: LocalEntity, generation?: number) => void;
  getSnapshot: () => MissionStoreSnapshot;
  loadOlder: (limit?: number, generation?: number) => Promise<boolean>;
  prependTranscript: (
    items: readonly TranscriptItem[],
    hasMore: boolean,
    generation?: number
  ) => void;
  refresh: (generation?: number) => Promise<boolean>;
  start: () => void;
  stop: () => void;
  subscribe: (listener: () => void) => () => void;
}

export interface MissionStoreOptions {
  eventsUrl: (after: number | undefined) => string;
  fetchSnapshot: (
    missionId: string,
    signal: AbortSignal
  ) => Promise<MissionSnapshot>;
  fetchTranscript?: (
    missionId: string,
    before: number,
    limit: number,
    signal: AbortSignal
  ) => Promise<{ items: TranscriptItem[]; nextCursor: string | null }>;
  missionId: string;
  onEvents?: (events: readonly DaemonEvent[]) => void;
  onMission?: (mission: Mission) => void;
  onReconnect?: () => void;
  openStream?: OpenEventStream;
}

const LOG_LIMIT = 2000;
const PAGE_SIZE = 100;

const localKey = (entity: LocalEntity) => `${entity.kind}:${entity.value.id}`;

const eventLocal = (event: DaemonEvent): LocalEntity | null => {
  switch (event.type) {
    case "mission.updated": {
      return { kind: "mission", value: event.data.mission };
    }
    case "queue.updated": {
      return { kind: "queue", value: event.data.item };
    }
    case "permission.updated": {
      return { kind: "permission", value: event.data.request };
    }
    case "question.updated": {
      return { kind: "question", value: event.data.question };
    }
    case "plan.updated": {
      return { kind: "plan", value: event.data.plan };
    }
    default: {
      return null;
    }
  }
};

const confirmsEvent = (
  current: LocalEntity | undefined,
  local: LocalEntity
): boolean => {
  switch (current?.kind) {
    case "mission": {
      return (
        local.kind === "mission" &&
        current.value.revision >= local.value.revision
      );
    }
    case "queue": {
      return (
        local.kind === "queue" && current.value.revision >= local.value.revision
      );
    }
    case "permission": {
      return (
        local.kind === "permission" &&
        current.value.epoch >= local.value.epoch &&
        current.value.status !== "pending"
      );
    }
    case "question": {
      return (
        local.kind === "question" &&
        current.value.epoch >= local.value.epoch &&
        current.value.status !== "pending"
      );
    }
    case "plan": {
      return (
        local.kind === "plan" &&
        current.value.revision >= local.value.revision &&
        current.value.status !== "proposed"
      );
    }
    default: {
      return false;
    }
  }
};

const confirmsDecision = (
  current: string | undefined,
  local: string,
  newer: boolean
) =>
  current !== undefined &&
  (current === local ||
    (newer && current !== "pending" && current !== "proposed"));

/** A snapshot/event can acknowledge a local result, but not undo its decision. */
const confirms = (
  live: MissionLiveState,
  entity: LocalEntity,
  after: number
): boolean => {
  const newer = (key: string) =>
    Math.max(live.base, live.versions[key] ?? 0) > after;
  switch (entity.kind) {
    case "mission": {
      return live.mission.revision >= entity.value.revision;
    }
    case "queue": {
      return (
        (live.queue[entity.value.id]?.revision ?? -1) >= entity.value.revision
      );
    }
    case "permission": {
      const current = live.permissions[entity.value.id];
      return (
        current !== undefined &&
        current.epoch >= entity.value.epoch &&
        confirmsDecision(
          current.status,
          entity.value.status,
          newer(`permissions:${entity.value.id}`)
        )
      );
    }
    case "question": {
      const current = live.questions[entity.value.id];
      return (
        current !== undefined &&
        current.epoch >= entity.value.epoch &&
        confirmsDecision(
          current.status,
          entity.value.status,
          newer(`questions:${entity.value.id}`)
        )
      );
    }
    case "plan": {
      const current = live.plans[entity.value.id];
      return (
        current !== undefined &&
        (current.revision > entity.value.revision ||
          (current.revision === entity.value.revision &&
            confirmsDecision(
              current.status,
              entity.value.status,
              newer(`plans:${entity.value.id}`)
            )))
      );
    }
    default: {
      return false;
    }
  }
};

/**
 * Owns every asynchronous read and write into one mission session. Transport
 * callbacks, reads, and caller callbacks are generation scoped; a stopped
 * generation can neither publish state nor open another stream.
 */
export const createMissionStore = ({
  eventsUrl,
  fetchSnapshot,
  fetchTranscript,
  missionId,
  onEvents,
  onMission,
  onReconnect,
  openStream = openEventStream,
}: MissionStoreOptions): MissionStore => {
  let state: MissionStoreSnapshot = {
    error: null,
    generation: 0,
    live: null,
    status: "loading",
  };
  const listeners = new Set<() => void>();
  const locals = new Map<string, { after: number; entity: LocalEntity }>();
  let log: DaemonEvent[] = [];
  let replayFloor = 0;
  let stream: EventStream | null = null;
  let controller: AbortController | null = null;
  let pageController: AbortController | null = null;
  let recoveryTimer: ReturnType<typeof setTimeout> | null = null;
  let recoveryAttempt = 0;
  let needsRecovery = true;
  let restartAfterRecovery = false;
  let running = false;
  const streamId = `mission:${missionId}`;

  const active = (generation: number) =>
    running && generation === state.generation;

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

  const overlay = (
    live: MissionLiveState,
    acknowledged?: Map<string, { entity: LocalEntity; seq: number }>
  ) => {
    let next = live;
    for (const [key, { after, entity }] of locals) {
      const candidate = acknowledged?.get(key);
      const confirmed = acknowledged
        ? candidate !== undefined &&
          candidate.seq > after &&
          confirmsEvent(candidate.entity, entity)
        : confirms(next, entity, after);
      if (confirmed) {
        locals.delete(key);
      } else {
        next = applyLocal(next, entity);
      }
    }
    return next;
  };

  const clearRecovery = () => {
    if (recoveryTimer !== null) {
      clearTimeout(recoveryTimer);
      recoveryTimer = null;
    }
  };

  const bridgeTranscript = async (
    snapshot: MissionSnapshot,
    signal: AbortSignal
  ) => {
    const previous = Object.values(state.live?.transcript ?? {});
    const newest = Math.max(-1, ...previous.map((item) => item.seq));
    const items = new Map(snapshot.transcript.map((item) => [item.seq, item]));
    // Retained final items may already prove continuity across a snapshot tail.
    for (const event of log) {
      if (event.type === "transcript.item" && event.seq > snapshot.cursor) {
        items.set(event.data.item.seq, event.data.item);
      }
    }
    const contiguousStart = () => {
      let start = Math.max(-1, ...items.keys());
      while (items.has(start - 1)) {
        start -= 1;
      }
      return start;
    };
    const fill = async (before: number): Promise<void> => {
      if (newest < 0 || before <= newest + 1 || !Number.isFinite(before)) {
        return;
      }
      if (!fetchTranscript) {
        throw new Error("Snapshot is missing intervening transcript history");
      }
      const page = await fetchTranscript(missionId, before, PAGE_SIZE, signal);
      signal.throwIfAborted();
      const older = page.items.filter((item) => item.missionId === missionId);
      const next = Math.min(...older.map((item) => item.seq));
      if (next >= before || !Number.isFinite(next)) {
        throw new Error("Transcript recovery made no progress");
      }
      for (const item of older) {
        if (!items.has(item.seq)) {
          items.set(item.seq, item);
        }
      }
      const start = contiguousStart();
      if (start >= before) {
        throw new Error("Transcript recovery left a sequence gap");
      }
      await fill(start);
    };
    await fill(contiguousStart());
    return { ...snapshot, transcript: [...items.values()] };
  };

  /** Never rejects: failures are observable through getSnapshot(). */
  const load = async (generation = state.generation): Promise<boolean> => {
    if (!active(generation)) {
      return false;
    }
    clearRecovery();
    controller?.abort();
    const current = new AbortController();
    controller = current;
    const currentRead = () =>
      active(generation) && controller === current && !current.signal.aborted;
    try {
      const fetched = await fetchSnapshot(missionId, current.signal);
      if (!currentRead()) {
        return false;
      }
      const snapshot = await bridgeTranscript(fetched, current.signal);
      if (!currentRead()) {
        return false;
      }
      if (
        snapshot.mission.id !== missionId ||
        snapshot.cursor < Math.max(replayFloor, state.live?.base ?? 0) ||
        hasGap(snapshot.cursor, log)
      ) {
        needsRecovery = true;
        throw new Error("Snapshot does not cover retained mission history");
      }
      const next = overlay(rebase(snapshot, log, state.live));
      log = log.filter((event) => event.seq > snapshot.cursor);
      replayFloor = snapshot.cursor;
      needsRecovery = false;
      recoveryAttempt = 0;
      set({ error: null, live: next, status: "ready" });
      if (active(generation) && restartAfterRecovery) {
        restartAfterRecovery = false;
        stream?.restart();
      }
      return true;
    } catch (error) {
      if (!currentRead()) {
        return false;
      }
      needsRecovery = true;
      set({ error, status: state.live ? "ready" : "error" });
      return false;
    } finally {
      if (currentRead()) {
        controller = null;
        if (needsRecovery) {
          recoveryAttempt += 1;
          recoveryTimer = setTimeout(() => {
            recoveryTimer = null;
            void load(generation);
          }, backoffDelay(recoveryAttempt));
        }
      }
    }
  };

  const remember = (events: readonly DaemonEvent[]) => {
    const retained = new Map(log.map((event) => [event.seq, event]));
    for (const event of events) {
      if (event.seq > replayFloor) {
        retained.set(event.seq, event);
      }
    }
    log = [...retained.values()].toSorted((a, b) => a.seq - b.seq);
    if (log.length > LOG_LIMIT) {
      const dropped = log.splice(0, log.length - LOG_LIMIT);
      replayFloor = Math.max(replayFloor, dropped.at(-1)?.seq ?? 0);
    }
  };

  const recover = (generation: number) => {
    needsRecovery = true;
    restartAfterRecovery = true;
    if (!controller) {
      void load(generation);
    }
  };

  const connect = (generation: number) => {
    if (!active(generation) || stream) {
      return;
    }
    const opened = openStream({
      onEvents: (received) => {
        if (!active(generation)) {
          return;
        }
        const events = received.filter(
          (event) => event.missionId === missionId
        );
        remember(events);
        onEvents?.(events);
        if (!active(generation)) {
          return;
        }
        if (
          !state.live ||
          needsRecovery ||
          hasGap(state.live.applied, events)
        ) {
          recover(generation);
          return;
        }
        const acknowledged = new Map<
          string,
          { entity: LocalEntity; seq: number }
        >();
        for (const event of events.toSorted((a, b) => a.seq - b.seq)) {
          const entity = eventLocal(event);
          if (entity && event.seq > state.live.base) {
            acknowledged.set(localKey(entity), { entity, seq: event.seq });
          }
        }
        set({ live: overlay(applyEvents(state.live, events), acknowledged) });
      },
      onOpen: (reconnected) => {
        if (active(generation) && (reconnected || !state.live)) {
          onReconnect?.();
          void load(generation);
        }
      },
      onResync: (oldestSeq) => {
        if (active(generation)) {
          // Never forget the proof needed to reject an older snapshot.
          replayFloor = Math.max(replayFloor, (oldestSeq ?? 1) - 1);
          onReconnect?.();
          recover(generation);
        }
      },
      onStatus: (status) => {
        if (active(generation)) {
          reportStream(streamId, {
            retryNow: () => stream?.retryNow(),
            status,
          });
        }
      },
      url: () => eventsUrl(state.live?.applied),
    });
    if (active(generation) && !stream) {
      stream = opened;
    } else {
      opened.close();
    }
  };

  const begin = async (generation: number) => {
    await load(generation);
    connect(generation);
  };

  const loadOlder = async (
    limit = PAGE_SIZE,
    generation = state.generation
  ): Promise<boolean> => {
    if (
      !active(generation) ||
      !state.live?.transcriptHasMore ||
      !fetchTranscript ||
      pageController
    ) {
      return false;
    }
    const before = Math.min(
      ...Object.values(state.live.transcript).map((item) => item.seq)
    );
    if (!Number.isFinite(before)) {
      return false;
    }
    const current = new AbortController();
    pageController = current;
    try {
      const page = await fetchTranscript(
        missionId,
        before,
        limit,
        current.signal
      );
      if (!active(generation) || current.signal.aborted || !state.live) {
        return false;
      }
      set({
        live: prependTranscript(
          state.live,
          page.items.filter((item) => item.missionId === missionId),
          page.nextCursor !== null
        ),
      });
      return true;
    } catch (error) {
      if (active(generation) && !current.signal.aborted) {
        set({ error });
      }
      return false;
    } finally {
      if (pageController === current) {
        pageController = null;
      }
    }
  };

  return {
    applyLocal: (entity, generation = state.generation) => {
      if (
        active(generation) &&
        state.live &&
        (entity.kind === "mission"
          ? entity.value.id
          : entity.value.missionId) === missionId
      ) {
        const next = applyLocal(state.live, entity);
        if (next !== state.live) {
          locals.set(localKey(entity), { after: state.live.applied, entity });
          set({ live: next });
        }
      }
    },
    getSnapshot: () => state,
    loadOlder,
    prependTranscript: (items, hasMore, generation = state.generation) => {
      if (active(generation) && state.live) {
        set({
          live: prependTranscript(
            state.live,
            items.filter((item) => item.missionId === missionId),
            hasMore
          ),
        });
      }
    },
    refresh: load,
    start: () => {
      if (running) {
        return;
      }
      running = true;
      const generation = state.generation + 1;
      set({ generation });
      void begin(generation);
    },
    stop: () => {
      running = false;
      controller?.abort();
      controller = null;
      pageController?.abort();
      pageController = null;
      clearRecovery();
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
