import { SSE_EVENT, SSE_RESYNC } from "@missions/protocol/http";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { openEventStream } from "./event-stream";
import type { EventStream, EventStreamOptions } from "./event-stream";
import { event, TestEventSource } from "./test-adapters";

const streams: EventStream[] = [];

const transport = (random = () => 0) => {
  let cursor = 10;
  const sources: TestEventSource[] = [];
  const onEvents = vi.fn<EventStreamOptions["onEvents"]>();
  const onOpen = vi.fn<EventStreamOptions["onOpen"]>();
  const onResync = vi.fn<EventStreamOptions["onResync"]>();
  const onStatus = vi.fn<EventStreamOptions["onStatus"]>();
  const stream = openEventStream(
    {
      onEvents,
      onOpen,
      onResync,
      onStatus,
      url: () => `/events?after=${cursor}`,
    },
    {
      createSource: (url) => {
        const source = new TestEventSource(url);
        sources.push(source);
        return source;
      },
      random,
    }
  );
  streams.push(stream);
  return {
    onEvents,
    onOpen,
    onResync,
    onStatus,
    setCursor: (next: number) => {
      cursor = next;
    },
    sources,
    stream,
  };
};

describe("EventSource transport policy", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    for (const stream of streams.splice(0)) {
      stream.close();
    }
    vi.useRealTimers();
  });

  it("validates frames and batches events within one frame", async () => {
    const { onEvents, sources } = transport();
    sources[0]?.emit(SSE_EVENT, "not json");
    sources[0]?.emit(SSE_EVENT, JSON.stringify({ seq: 11 }));
    sources[0]?.send(event(11), event(12));
    expect(onEvents).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(16);
    expect(onEvents).toHaveBeenCalledExactlyOnceWith([event(11), event(12)]);
  });

  it("flushes before resync and detaches late callbacks on restart", () => {
    const { onEvents, onOpen, onResync, sources, stream, setCursor } =
      transport();
    sources[0]?.emit("open");
    sources[0]?.send(event(11));
    sources[0]?.emit(
      SSE_RESYNC,
      JSON.stringify({ oldestSeq: 30, reason: "cursor_expired" })
    );
    expect(onEvents).toHaveBeenCalledExactlyOnceWith([event(11)]);
    expect(onResync).toHaveBeenCalledExactlyOnceWith(30);
    setCursor(30);
    stream.restart();
    sources[0]?.emit("open");
    sources[0]?.send(event(99));
    sources[0]?.emit(SSE_RESYNC, "not json");
    sources[0]?.emit("error");
    sources[1]?.emit("open");
    expect({
      closed: sources[0]?.closed,
      events: onEvents.mock.calls.length,
      opens: onOpen.mock.calls,
      resyncs: onResync.mock.calls.length,
      timers: vi.getTimerCount(),
      url: sources[1]?.url,
    }).toStrictEqual({
      closed: true,
      events: 1,
      opens: [[false], [true]],
      resyncs: 1,
      timers: 0,
      url: "/events?after=30",
    });
  });

  it("uses bounded equal-jitter backoff, current cursors, and retry-now without duplicate connections", async () => {
    const { onStatus, sources, stream, setCursor } = transport(() => 1);
    sources[0]?.emit("error");
    expect(onStatus.mock.lastCall?.[0]).toMatchObject({
      attempt: 1,
      phase: "retrying",
      retryAt: Date.now() + 500,
    });
    await vi.advanceTimersByTimeAsync(499);
    const connectionsBeforeRetry = sources.length;
    setCursor(12);
    await vi.advanceTimersByTimeAsync(1);
    const resumedUrl = sources[1]?.url;
    sources[1]?.emit("error");
    expect(onStatus.mock.lastCall?.[0]).toMatchObject({
      attempt: 2,
      phase: "retrying",
      retryAt: Date.now() + 1000,
    });
    stream.retryNow();
    stream.retryNow();
    const immediateRetry = {
      connections: sources.length,
      timers: vi.getTimerCount(),
    };
    sources[2]?.emit("open");
    sources[2]?.emit("error");
    expect(onStatus.mock.lastCall?.[0]).toMatchObject({
      attempt: 1,
      phase: "retrying",
    });
    stream.close();
    await vi.advanceTimersByTimeAsync(60_000);
    expect({
      active: sources.filter((source) => !source.closed).length,
      connections: sources.length,
      connectionsBeforeRetry,
      immediateRetry,
      resumedUrl,
    }).toStrictEqual({
      active: 0,
      connections: 3,
      connectionsBeforeRetry: 1,
      immediateRetry: { connections: 3, timers: 0 },
      resumedUrl: "/events?after=12",
    });
  });
});
