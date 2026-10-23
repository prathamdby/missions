import { setImmediate } from "node:timers/promises";

import { SSE_HEARTBEAT_MS, SSE_RESYNC } from "@missions/protocol/http";
import { Hono } from "hono";
import { SSEStreamingApi } from "hono/streaming";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { openDatabase } from "../db/database";
import type { DatabaseHandle } from "../db/database";
import { Store } from "../db/store";
import { EventLog } from "./event-log";
import { eventStream } from "./sse";

const opened: DatabaseHandle[] = [];
const controllers: AbortController[] = [];
const notice = (message: string) =>
  ({
    data: {
      notice: { code: "info", level: "info", message, retryAfterMs: null },
    },
    type: "notice",
  }) as const;

const flush = () => setImmediate();

const setup = (retainPerStream?: number) => {
  const handle = openDatabase(":memory:");
  opened.push(handle);
  const log = new EventLog(new Store(handle), { retainPerStream });
  const subscribe = log.subscribe.bind(log);
  const unsubscribed = vi.fn<() => void>();
  vi.spyOn(log, "subscribe").mockImplementation((listener) => {
    const release = subscribe(listener);
    return () => {
      release();
      unsubscribed();
    };
  });
  const replay = vi.spyOn(log, "replay");
  const app = new Hono();
  app.get("/events", (c) => eventStream(c, log));
  const connect = async (query = "", headers?: Record<string, string>) => {
    const controller = new AbortController();
    controllers.push(controller);
    const response = await app.request(`/events${query}`, {
      headers,
      signal: controller.signal,
    });
    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error("Expected an event stream");
    }
    return { controller, reader };
  };
  return { connect, log, replay, unsubscribed };
};

const readFrames = async (
  reader: ReadableStreamDefaultReader<Uint8Array>,
  count: number
) => {
  const decoder = new TextDecoder();
  let text = "";
  const results = async function* results() {
    for (;;) {
      yield reader.read();
    }
  };
  for await (const { done, value } of results()) {
    if (done) {
      break;
    }
    text += decoder.decode(value, { stream: true });
    if (text.split("\n\n").length - 1 >= count) {
      break;
    }
  }
  return text;
};

const idsOf = (text: string) =>
  [...text.matchAll(/^id: (?<id>\d+)$/gmu)].map((match) =>
    Number(match.groups?.id)
  );

describe("event stream lifecycle", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
  });

  afterEach(async () => {
    for (const controller of controllers.splice(0)) {
      controller.abort();
    }
    await flush();
    vi.restoreAllMocks();
    vi.useRealTimers();
    for (const handle of opened.splice(0)) {
      handle.close();
    }
  });

  it("captures a finite replay high-water and delivers live events once in order", async () => {
    const { connect, log, replay } = setup();
    for (let index = 1; index <= 501; index += 1) {
      log.publish("mission-one", notice(String(index)));
    }
    const { controller, reader } = await connect(
      "?missionId=mission-one&after=0"
    );
    log.publish("mission-two", notice("other stream"));
    log.publish("mission-one", notice("live-one"));
    log.publish("mission-one", notice("live-two"));
    expect(idsOf(await readFrames(reader, 503))).toStrictEqual(
      Array.from({ length: 503 }, (_, index) => index + 1)
    );
    expect(replay.mock.calls.map((args) => args[1])).toStrictEqual([0, 500]);
    controller.abort();
  });

  it("disconnects overflow and releases a subscription even with replay blocked", async () => {
    const { connect, log, replay, unsubscribed } = setup();
    for (let index = 0; index < 600; index += 1) {
      log.publish(null, notice("history"));
    }
    const { reader } = await connect();
    await flush();
    log.commit((emit) => {
      for (let index = 0; index <= 5000; index += 1) {
        emit(null, notice("live"));
      }
    });
    expect(unsubscribed).toHaveBeenCalledWith();
    expect(vi.getTimerCount()).toBe(0);
    await flush();
    // No second history batch is fetched after overflow.
    expect(replay).toHaveBeenCalledOnce();
    expect(idsOf(await readFrames(reader, 10)).length).toBeLessThanOrEqual(1);
  });

  it("cancels blocked replay promptly on request abort", async () => {
    const { connect, log, replay, unsubscribed } = setup();
    for (let index = 0; index < 600; index += 1) {
      log.publish(null, notice("history"));
    }
    const { controller, reader } = await connect();
    await flush();
    controller.abort();
    expect(unsubscribed).toHaveBeenCalledWith();
    expect(vi.getTimerCount()).toBe(0);
    await flush();
    expect(replay).toHaveBeenCalledOnce();
    expect(idsOf(await readFrames(reader, 10)).length).toBeLessThanOrEqual(1);
  });

  it("disconnects on live overflow without scheduling additional writes", async () => {
    const write = vi.spyOn(SSEStreamingApi.prototype, "write");
    const { connect, log, unsubscribed } = setup();
    const { reader } = await connect();
    log.publish(null, notice("prefetched"));
    log.publish(null, notice("blocked"));
    await flush();
    const blockedCount = write.mock.calls.length;
    log.commit((emit) => {
      for (let index = 0; index <= 5000; index += 1) {
        emit(null, notice("overflow"));
      }
    });
    await flush();
    expect(unsubscribed).toHaveBeenCalledWith();
    expect(vi.getTimerCount()).toBe(0);
    expect(write).toHaveBeenCalledTimes(blockedCount);
    expect(idsOf(await readFrames(reader, 10))).toStrictEqual([1]);
  });

  it("cleans up on reader cancellation without requiring request abort", async () => {
    const { connect, unsubscribed } = setup();
    const { reader } = await connect();
    await reader.cancel();
    expect(unsubscribed).toHaveBeenCalledWith();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("never queues heartbeat writes behind blocked replay or live delivery", async () => {
    const write = vi.spyOn(SSEStreamingApi.prototype, "write");
    const { connect, log } = setup();
    for (let index = 0; index < 3; index += 1) {
      log.publish(null, notice("history"));
    }
    const { reader } = await connect();
    await flush();
    const blockedCount = write.mock.calls.length;
    await vi.advanceTimersByTimeAsync(SSE_HEARTBEAT_MS * 10);
    expect(write).toHaveBeenCalledTimes(blockedCount);
    expect(
      write.mock.calls.filter(([input]) => input === ": keep-alive\n\n")
    ).toStrictEqual([]);
    log.publish(null, notice("live"));
    expect(idsOf(await readFrames(reader, 4))).toStrictEqual([1, 2, 3, 4]);
  });

  it("allows only one pending idle heartbeat for a blocked reader", async () => {
    const write = vi.spyOn(SSEStreamingApi.prototype, "write");
    const { connect } = setup();
    await connect();
    await vi.advanceTimersByTimeAsync(SSE_HEARTBEAT_MS * 20);
    // The response can prefetch one frame; its next write stays backpressured.
    expect(write).toHaveBeenCalledTimes(2);
  });

  it("resyncs expired cursors and removes the timer and subscription", async () => {
    const { connect, log, unsubscribed } = setup(2);
    for (let index = 0; index < 4; index += 1) {
      log.publish(null, notice("history"));
    }
    log.prune(null);
    const { reader } = await connect("?after=0");
    const frame = await readFrames(reader, 1);
    expect(frame).toContain(`event: ${SSE_RESYNC}`);
    expect(frame).toContain('"oldestSeq":3');
    await flush();
    expect(unsubscribed).toHaveBeenCalledWith();
    expect(vi.getTimerCount()).toBe(0);
    const end = await reader.read();
    expect(end.done).toBeTruthy();
  });

  it("resyncs if retention removes the next replay batch while the reader is blocked", async () => {
    const { connect, log } = setup(2);
    for (let index = 0; index < 600; index += 1) {
      log.publish(null, notice("history"));
    }
    const { reader } = await connect();
    log.prune(null);
    const text = await readFrames(reader, 501);
    expect(idsOf(text)).toStrictEqual(
      Array.from({ length: 500 }, (_, index) => index + 1)
    );
    expect(text).toContain(`event: ${SSE_RESYNC}`);
    expect(text).toContain('"oldestSeq":599');
  });

  it("honors Last-Event-ID and keeps global events separate", async () => {
    const { connect, log } = setup();
    log.publish(null, notice("global-one"));
    log.publish("mission-one", notice("mission-only"));
    log.publish(null, notice("global-two"));
    const { reader } = await connect("", { "last-event-id": "1" });
    const frame = await readFrames(reader, 1);
    expect(idsOf(frame)).toStrictEqual([2]);
    expect(frame).toContain("global-two");
    expect(frame).not.toContain("mission-only");
  });
});
