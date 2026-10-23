import {
  DaemonEventSchema,
  ResyncRequiredSchema,
} from "@missions/protocol/events";
import type { DaemonEvent } from "@missions/protocol/events";
import { SSE_EVENT, SSE_RESYNC } from "@missions/protocol/http";

import { backoffDelay } from "./backoff";

export type StreamPhase = "closed" | "connecting" | "open" | "retrying";

export interface StreamStatus {
  attempt: number;
  phase: StreamPhase;
  retryAt: number | null;
}

export interface EventStreamOptions {
  onEvents: (events: DaemonEvent[]) => void;
  /** Called on every successful open; `reconnected` is false only for the first. */
  onOpen: (reconnected: boolean) => void;
  onResync: (oldestSeq: number | null) => void;
  onStatus: (status: StreamStatus) => void;
  /** Read on every connect so the resume cursor is current. */
  url: () => string;
}

export interface EventStream {
  close: () => void;
  /** Reconnect now with a fresh URL (after a resync rebased the cursor). */
  restart: () => void;
  retryNow: () => void;
}

/** The browser transport is replaceable without replacing reconnect/batch policy. */
export interface EventSourceAdapter {
  addEventListener: (
    type: string,
    listener: (event: { data?: unknown }) => void
  ) => void;
  close: () => void;
}

export interface StreamTransport {
  createSource?: (url: string) => EventSourceAdapter;
  random?: () => number;
}

export type OpenEventStream = (options: EventStreamOptions) => EventStream;

/** Events that arrive within one frame are applied together. */
const BATCH_MS = 16;

const parseJson = (data: unknown): unknown => {
  if (typeof data !== "string") {
    return null;
  }
  try {
    return JSON.parse(data) as unknown;
  } catch {
    return null;
  }
};

/**
 * One EventSource with controlled reconnects. The browser's built-in retry is
 * replaced by bounded, jittered backoff so many tabs do not hammer a daemon
 * that is restarting.
 */
export const openEventStream = (
  options: EventStreamOptions,
  { createSource = (url) => new EventSource(url), random }: StreamTransport = {}
): EventStream => {
  let source: EventSourceAdapter | null = null;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  let flushTimer: ReturnType<typeof setTimeout> | null = null;
  let batch: DaemonEvent[] = [];
  let everOpened = false;
  let closed = false;
  let status: StreamStatus = { attempt: 0, phase: "connecting", retryAt: null };

  const update = (patch: Partial<StreamStatus>) => {
    status = { ...status, ...patch };
    options.onStatus(status);
  };

  const flush = () => {
    if (flushTimer !== null) {
      clearTimeout(flushTimer);
      flushTimer = null;
    }
    if (batch.length === 0) {
      return;
    }
    const events = batch;
    batch = [];
    options.onEvents(events);
  };

  const clearRetry = () => {
    if (retryTimer !== null) {
      clearTimeout(retryTimer);
      retryTimer = null;
    }
  };

  const detach = () => {
    source?.close();
    source = null;
  };

  const connect = () => {
    if (closed) {
      return;
    }
    clearRetry();
    detach();
    update({ phase: "connecting", retryAt: null });
    const current = createSource(options.url());
    source = current;

    current.addEventListener("open", () => {
      if (closed || source !== current) {
        return;
      }
      const reconnected = everOpened;
      everOpened = true;
      update({ attempt: 0, phase: "open", retryAt: null });
      options.onOpen(reconnected);
    });

    current.addEventListener(SSE_EVENT, (message) => {
      if (closed || source !== current) {
        return;
      }
      const parsed = DaemonEventSchema.safeParse(parseJson(message.data));
      if (parsed.success) {
        batch.push(parsed.data);
        flushTimer ??= setTimeout(flush, BATCH_MS);
      }
    });

    current.addEventListener(SSE_RESYNC, (message) => {
      if (closed || source !== current) {
        return;
      }
      flush();
      const parsed = ResyncRequiredSchema.safeParse(parseJson(message.data));
      options.onResync(parsed.success ? parsed.data.oldestSeq : null);
    });

    current.addEventListener("error", () => {
      if (source !== current) {
        return;
      }
      detach();
      flush();
      if (closed) {
        return;
      }
      const attempt = status.attempt + 1;
      const delay = backoffDelay(attempt, { random });
      update({ attempt, phase: "retrying", retryAt: Date.now() + delay });
      retryTimer = setTimeout(connect, delay);
    });
  };

  connect();

  return {
    close: () => {
      closed = true;
      clearRetry();
      detach();
      batch = [];
      if (flushTimer !== null) {
        clearTimeout(flushTimer);
      }
      update({ phase: "closed", retryAt: null });
    },
    restart: () => {
      flush();
      connect();
    },
    retryNow: () => {
      if (status.phase === "retrying") {
        connect();
      }
    },
  };
};
