import type { DaemonEvent } from "@missions/protocol/events";
import {
  SSE_EVENT,
  SSE_HEARTBEAT_MS,
  SSE_RESYNC,
} from "@missions/protocol/http";
import type { Context } from "hono";
import { streamSSE } from "hono/streaming";
import type { SSEStreamingApi } from "hono/streaming";

import { notFound } from "../lib/app-error";
import type { EventLog } from "./event-log";

/** At most this many live events plus one in-flight frame are retained. */
const MAX_BUFFERED = 5000;
const REPLAY_BATCH = 500;
type ReplayFrame = DaemonEvent | { oldestSeq: number };
type Frame = ReplayFrame | "heartbeat" | null;
export type MissionExists = (missionId: string) => boolean;

const parseCursor = (raw: string | undefined | null) => {
  if (!raw) {
    return 0;
  }
  const value = Number(raw);
  return Number.isSafeInteger(value) && value >= 0 ? value : 0;
};

/**
 * One writer owns replay, live delivery, and heartbeats. The subscription only
 * buffers events beyond the captured replay high-water; it never starts writes.
 */
class EventSession {
  readonly #stream: SSEStreamingApi;
  readonly #log: EventLog;
  readonly #missionId: string | null;
  readonly #signal: AbortSignal;
  readonly #highWater: number;
  readonly #oldest: number;
  readonly #buffered: DaemonEvent[] = [];
  readonly #unsubscribe: () => void;
  readonly #heartbeat: ReturnType<typeof setInterval>;
  #cursor: number;
  #stopped = false;
  /** The mission was removed: deliver what is buffered, then end the stream. */
  #ended = false;
  #writing = false;
  #heartbeatDue = false;
  #wake: (() => void) | undefined;

  constructor(
    stream: SSEStreamingApi,
    log: EventLog,
    missionId: string | null,
    after: number,
    signal: AbortSignal,
    missionExists?: MissionExists
  ) {
    this.#stream = stream;
    this.#log = log;
    this.#missionId = missionId;
    this.#cursor = after;
    this.#signal = signal;
    const { latest, oldest } = log.bounds(missionId);
    this.#highWater = latest;
    this.#oldest = oldest;
    // No asynchronous gap between the high-water capture and subscription.
    this.#unsubscribe = log.subscribe((event) => {
      if (
        missionId !== null &&
        event.type === "mission.removed" &&
        event.data.missionId === missionId
      ) {
        this.#ended = true;
        this.#wake?.();
        return;
      }
      if (
        this.#stopped ||
        event.missionId !== missionId ||
        event.seq <= Math.max(this.#highWater, this.#cursor)
      ) {
        return;
      }
      if (this.#buffered.length >= MAX_BUFFERED) {
        // A blocked reader cannot receive a resync frame either. Disconnect
        // rather than keep a pending replay/write and subscription alive.
        this.#stop();
        return;
      }
      this.#buffered.push(event);
      this.#wake?.();
    });
    // Checked after subscribing: a removal is either seen here or delivered above.
    if (missionId !== null && missionExists && !missionExists(missionId)) {
      this.#ended = true;
    }
    this.#heartbeat = setInterval(() => {
      if (!this.#writing && this.#buffered.length === 0) {
        this.#heartbeatDue = true;
        this.#wake?.();
      }
    }, SSE_HEARTBEAT_MS);
    stream.onAbort(this.#stop);
    signal.addEventListener("abort", this.#stop, { once: true });
    if (signal.aborted || stream.aborted) {
      this.#stop();
    }
  }

  #dispose() {
    clearInterval(this.#heartbeat);
    this.#unsubscribe();
    this.#signal.removeEventListener("abort", this.#stop);
    this.#buffered.length = 0;
  }

  readonly #stop = () => {
    if (this.#stopped) {
      return;
    }
    this.#stopped = true;
    this.#dispose();
    this.#wake?.();
    // Cancels the underlying reader, releasing even a backpressured write.
    this.#stream.abort();
  };

  async #write(effect: () => Promise<unknown>) {
    if (this.#stopped) {
      return;
    }
    this.#writing = true;
    try {
      await effect();
    } finally {
      this.#writing = false;
    }
  }

  async #send(event: DaemonEvent) {
    await this.#write(() =>
      this.#stream.writeSSE({
        data: JSON.stringify(event),
        event: SSE_EVENT,
        id: String(event.seq),
      })
    );
    this.#cursor = event.seq;
  }

  async #resync(oldest: number) {
    await this.#write(() =>
      this.#stream.writeSSE({
        data: JSON.stringify({ oldestSeq: oldest, reason: "cursor_expired" }),
        event: SSE_RESYNC,
      })
    );
  }

  *#replay(): Generator<ReplayFrame, boolean> {
    if (this.#oldest > 0 && this.#cursor < this.#oldest - 1) {
      yield { oldestSeq: this.#oldest };
      return false;
    }
    while (!this.#stopped && !this.#ended && this.#cursor < this.#highWater) {
      const batch = this.#log
        .replay(this.#missionId, this.#cursor, REPLAY_BATCH)
        .filter((event) => event.seq <= this.#highWater);
      if (batch[0]?.seq !== this.#cursor + 1) {
        // Retention may advance while a reader is blocked during replay.
        yield { oldestSeq: this.#log.bounds(this.#missionId).oldest };
        return false;
      }
      for (const event of batch) {
        if (this.#stopped) {
          return false;
        }
        yield event;
      }
    }
    return !(this.#stopped || this.#ended);
  }

  async #nextLive(): Promise<Frame> {
    if (this.#stopped) {
      return null;
    }
    const event = this.#buffered.shift();
    if (event) {
      return event;
    }
    if (this.#ended) {
      return null;
    }
    if (this.#heartbeatDue) {
      this.#heartbeatDue = false;
      return "heartbeat";
    }
    const { promise, resolve } = Promise.withResolvers<undefined>();
    this.#wake = () => resolve(undefined);
    await promise;
    this.#wake = undefined;
    return this.#nextLive();
  }

  async *#frames(): AsyncGenerator<Frame> {
    const replayed = yield* this.#replay();
    if (!replayed) {
      return;
    }
    while (!this.#stopped) {
      yield this.#nextLive();
    }
  }

  async run() {
    try {
      for await (const frame of this.#frames()) {
        if (this.#stopped || frame === null) {
          break;
        }
        if (frame === "heartbeat") {
          await this.#write(() => this.#stream.write(": keep-alive\n\n"));
        } else if ("oldestSeq" in frame) {
          await this.#resync(frame.oldestSeq);
        } else {
          await this.#send(frame);
        }
      }
    } finally {
      this.#stopped = true;
      this.#dispose();
    }
  }
}

/**
 * Snapshot cursor -> bounded replay -> live delivery, scoped to one stream.
 * With `missionExists`, a missing mission is 404 and a removed one ends its stream.
 */
export const eventStream = (
  c: Context,
  log: EventLog,
  missionExists?: MissionExists
) => {
  const missionId = c.req.query("missionId") ?? null;
  if (missionId !== null && missionExists && !missionExists(missionId)) {
    throw notFound("Mission");
  }
  const after = parseCursor(
    c.req.query("after") ?? c.req.header("last-event-id")
  );
  return streamSSE(c, async (stream) => {
    await new EventSession(
      stream,
      log,
      missionId,
      after,
      c.req.raw.signal,
      missionExists
    ).run();
  });
};
