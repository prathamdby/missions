import type { DaemonEvent } from "@missions/protocol/events";
import {
  SSE_EVENT,
  SSE_HEARTBEAT_MS,
  SSE_RESYNC,
} from "@missions/protocol/http";
import type { Context } from "hono";
import { streamSSE } from "hono/streaming";
import type { SSEStreamingApi } from "hono/streaming";

import type { EventLog } from "./event-log";

/** A subscriber that falls this far behind is told to resync instead of buffering forever. */
const MAX_BUFFERED = 5000;
const REPLAY_BATCH = 500;

const parseCursor = (raw: string | undefined | null) => {
  if (!raw) {
    return 0;
  }
  const value = Number(raw);
  return Number.isInteger(value) && value >= 0 ? value : 0;
};

const send = (stream: SSEStreamingApi, event: DaemonEvent) =>
  stream.writeSSE({
    data: JSON.stringify(event),
    event: SSE_EVENT,
    id: String(event.seq),
  });

/** Strictly sequential writes keep frame order. */
const sendAll = async (
  stream: SSEStreamingApi,
  list: readonly DaemonEvent[],
  index = 0
): Promise<void> => {
  const event = list[index];
  if (!event) {
    return;
  }
  await send(stream, event);
  await sendAll(stream, list, index + 1);
};

const replayFrom = async (
  stream: SSEStreamingApi,
  log: EventLog,
  missionId: string | null,
  after: number
): Promise<number> => {
  const batch = log.replay(missionId, after, REPLAY_BATCH);
  await sendAll(stream, batch);
  const cursor = batch.at(-1)?.seq ?? after;
  return batch.length === REPLAY_BATCH
    ? await replayFrom(stream, log, missionId, cursor)
    : cursor;
};

/**
 * Snapshot + replay: the client passes the cursor its snapshot reflects. Live
 * events are buffered while history replays, then deduplicated by sequence.
 */
export const eventStream = (c: Context, log: EventLog) => {
  const missionId = c.req.query("missionId") ?? null;
  const after = parseCursor(
    c.req.query("after") ?? c.req.header("last-event-id")
  );
  return streamSSE(c, async (stream) => {
    const { oldest } = log.bounds(missionId);
    if (oldest > 0 && after < oldest - 1) {
      await stream.writeSSE({
        data: JSON.stringify({ oldestSeq: oldest, reason: "cursor_expired" }),
        event: SSE_RESYNC,
      });
      return;
    }
    const buffered: DaemonEvent[] = [];
    let live = false;
    let overflow = false;
    let cursor = after;
    const { promise: closed, resolve: close } =
      Promise.withResolvers<undefined>();
    let draining = false;
    const drain = async () => {
      if (draining) {
        return;
      }
      draining = true;
      const ready = buffered.splice(0).filter((event) => event.seq > cursor);
      await sendAll(stream, ready);
      cursor = ready.at(-1)?.seq ?? cursor;
      draining = false;
      if (buffered.length > 0) {
        await drain();
      }
    };
    const unsubscribe = log.subscribe((event) => {
      if (event.missionId !== missionId) {
        return;
      }
      if (buffered.length >= MAX_BUFFERED) {
        overflow = true;
        close(undefined);
        return;
      }
      buffered.push(event);
      if (live) {
        void drain();
      }
    });
    stream.onAbort(() => close(undefined));
    const heartbeat = setInterval(() => {
      void stream.write(": keep-alive\n\n");
    }, SSE_HEARTBEAT_MS);
    try {
      cursor = await replayFrom(stream, log, missionId, after);
      live = true;
      await drain();
      await closed;
      if (overflow) {
        await stream.writeSSE({
          data: JSON.stringify({ oldestSeq: cursor, reason: "cursor_expired" }),
          event: SSE_RESYNC,
        });
      }
    } finally {
      clearInterval(heartbeat);
      unsubscribe();
    }
  });
};
