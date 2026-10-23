import { SSE_RESYNC } from "@missions/protocol/http";
import type { TranscriptItem } from "@missions/protocol/missions";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createMissionStore } from "./mission-store";
import type { MissionStore, MissionStoreOptions } from "./mission-store";
import {
  deferred,
  event,
  mission,
  MISSION_ID,
  permission,
  plan,
  question,
  queueItem,
  settle,
  snapshot,
  snapshotAdapter,
  streamAdapter,
  transcriptItem,
} from "./test-adapters";

const stores: MissionStore[] = [];

const session = (options: Partial<MissionStoreOptions> = {}) => {
  const reads = snapshotAdapter();
  const transport = streamAdapter();
  const store = createMissionStore({
    eventsUrl: (after) => `/events?missionId=${MISSION_ID}&after=${after}`,
    fetchSnapshot: reads.fetchSnapshot,
    missionId: MISSION_ID,
    openStream: transport.openStream,
    ...options,
  });
  stores.push(store);
  return { ...reads, ...transport, store };
};

const ready = async (
  options: Partial<MissionStoreOptions> = {},
  initial = snapshot()
) => {
  const result = session(options);
  result.store.start();
  result.reads[0]?.resolve(initial);
  await settle();
  result.sources[0]?.emit("open");
  return result;
};

describe("mission session lifecycle", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    for (const store of stores.splice(0)) {
      store.stop();
    }
    vi.useRealTimers();
  });

  it("start/stop/start cannot publish or connect the late first generation", async () => {
    const { reads, sources, store } = session();
    store.start();
    store.start();
    store.stop();
    store.start();
    reads[1]?.resolve(snapshot({ cursor: 20, mission: mission(2) }));
    await settle();
    reads[0]?.resolve(snapshot());
    await settle();
    expect(reads).toHaveLength(2);
    expect(reads[0]?.signal.aborted).toBeTruthy();
    expect(sources).toHaveLength(1);
    expect(sources[0]?.url).toContain("after=20");
    expect(store.getSnapshot().live?.mission.revision).toBe(2);
  });

  it("only the latest refresh can succeed even when reads ignore AbortSignal", async () => {
    const { reads, store } = await ready();
    const first = store.refresh();
    const second = store.refresh();
    reads[2]?.resolve(snapshot({ cursor: 12, mission: mission(3) }));
    await expect(second).resolves.toBeTruthy();
    reads[1]?.resolve(snapshot({ cursor: 11, mission: mission(2) }));
    await expect(first).resolves.toBeFalsy();
    expect(store.getSnapshot().live?.mission.revision).toBe(3);
    expect(store.getSnapshot().error).toBeNull();
  });

  it("stop disposes reads, frame batches, retry timers and late callbacks", async () => {
    const onMission = vi.fn<NonNullable<MissionStoreOptions["onMission"]>>();
    const { reads, sources, store } = await ready({ onMission });
    const listener = vi.fn<() => void>();
    store.subscribe(listener);
    const refresh = store.refresh();
    sources[0]?.send(event(11));
    sources[0]?.emit("error");
    store.stop();
    const stopped = store.getSnapshot();
    const notifications = listener.mock.calls.length;
    reads[1]?.resolve(snapshot({ cursor: 20, mission: mission(2) }));
    sources[0]?.emit("open");
    sources[0]?.send(event(21));
    await vi.advanceTimersByTimeAsync(30_000);
    await expect(refresh).resolves.toBeFalsy();
    expect(store.getSnapshot()).toBe(stopped);
    expect(listener).toHaveBeenCalledTimes(notifications);
    expect(onMission).toHaveBeenCalledOnce();
    expect({
      closed: sources[0]?.closed,
      connections: sources.length,
      timers: vi.getTimerCount(),
    }).toStrictEqual({ closed: true, connections: 1, timers: 0 });
  });

  it("reconnect preserves loaded pages and local responses while authoritative copies win", async () => {
    const { reads, sources, store } = await ready(
      {},
      snapshot({
        transcript: [transcriptItem(2)],
        transcriptHasMore: true,
      })
    );
    store.prependTranscript([transcriptItem(1)], false);
    store.applyLocal({ kind: "mission", value: mission(3) });
    sources[0]?.emit("error");
    await vi.advanceTimersByTimeAsync(250);
    expect(sources[1]?.url).toContain("after=10");
    sources[1]?.emit("open");
    reads[1]?.resolve(
      snapshot({
        cursor: 11,
        mission: mission(2),
        transcript: [transcriptItem(2, "Authoritative")],
        transcriptHasMore: true,
      })
    );
    await settle();
    const { live } = store.getSnapshot();
    expect({
      hasMore: live?.transcriptHasMore,
      oldText: live?.transcript["t-1"]?.text,
      revision: live?.mission.revision,
      text: live?.transcript["t-2"]?.text,
    }).toStrictEqual({
      hasMore: false,
      oldText: "Item 1",
      revision: 3,
      text: "Authoritative",
    });
    const refresh = store.refresh();
    reads[2]?.resolve(snapshot({ cursor: 12, mission: mission(4) }));
    await expect(refresh).resolves.toBeTruthy();
    expect(store.getSnapshot().live?.mission.revision).toBe(4);
  });

  it("unrelated or stale events do not acknowledge a newer local response", async () => {
    const { reads, sources, store } = await ready(
      {},
      snapshot({ permissions: [permission("pending")] })
    );
    store.applyLocal({ kind: "mission", value: mission(3) });
    store.applyLocal({ kind: "permission", value: permission("approved") });
    sources[0]?.send(
      event(11, { data: { mission: mission(2) }, type: "mission.updated" }),
      event(12, {
        data: { request: permission("pending") },
        type: "permission.updated",
      }),
      event(13)
    );
    await vi.advanceTimersByTimeAsync(16);
    const refresh = store.refresh();
    reads[1]?.resolve(
      snapshot({
        cursor: 13,
        mission: mission(2),
        permissions: [permission("pending")],
      })
    );
    await expect(refresh).resolves.toBeTruthy();
    expect(store.getSnapshot().live?.mission.revision).toBe(3);
    expect(store.getSnapshot().live?.permissions["permission-1"]?.status).toBe(
      "approved"
    );
    sources[0]?.send(
      event(14, {
        data: { request: permission("cancelled") },
        type: "permission.updated",
      })
    );
    await vi.advanceTimersByTimeAsync(16);
    expect(store.getSnapshot().live?.permissions["permission-1"]?.status).toBe(
      "cancelled"
    );
  });

  it("rejects snapshots older than bounded replay coverage instead of silently losing events", async () => {
    const { reads, sources, store } = await ready();
    const events = Array.from({ length: 2001 }, (_, index) =>
      event(index + 11)
    );
    sources[0]?.send(...events);
    await vi.advanceTimersByTimeAsync(16);
    const before = store.getSnapshot().live;
    const refresh = store.refresh();
    reads[1]?.resolve(snapshot());
    await expect(refresh).resolves.toBeFalsy();
    expect(store.getSnapshot().live).toBe(before);
    expect(store.getSnapshot().error).toBeInstanceOf(Error);
    const covered = store.refresh();
    reads[2]?.resolve(snapshot({ cursor: 11 }));
    await expect(covered).resolves.toBeTruthy();
    expect(store.getSnapshot().live?.applied).toBe(2011);
  });

  it("old terminal replays and equal-cursor snapshots cannot acknowledge a later local decision", async () => {
    const { reads, sources, store } = await ready();
    const approved = event(11, {
      data: { request: permission("approved") },
      type: "permission.updated",
    });
    sources[0]?.send(approved, event(12));
    await vi.advanceTimersByTimeAsync(16);
    store.applyLocal({ kind: "permission", value: permission("stale") });
    sources[0]?.send(approved);
    await vi.advanceTimersByTimeAsync(16);
    const refresh = store.refresh();
    reads[1]?.resolve(
      snapshot({ cursor: 12, permissions: [permission("approved")] })
    );
    await expect(refresh).resolves.toBeTruthy();
    expect(store.getSnapshot().live?.permissions["permission-1"]?.status).toBe(
      "stale"
    );
  });

  it("retains queue, plan and question responses until authoritative snapshots confirm them", async () => {
    const initial = snapshot({
      plans: [plan("proposed")],
      questions: [question("pending")],
      queue: [queueItem(1, "queued")],
    });
    const { reads, sources, store } = await ready({}, initial);
    store.applyLocal({ kind: "plan", value: plan("approved") });
    store.applyLocal({ kind: "question", value: question("answered") });
    store.applyLocal({ kind: "queue", value: queueItem(2, "removing") });
    sources[0]?.send(event(11));
    await vi.advanceTimersByTimeAsync(16);
    const refresh = store.refresh();
    reads[1]?.resolve({ ...initial, cursor: 11 });
    await expect(refresh).resolves.toBeTruthy();
    const local = store.getSnapshot().live;
    expect({
      plan: local?.plans["plan-1"]?.status,
      question: local?.questions["question-1"]?.status,
      queue: local?.queue["queue-1"]?.state,
    }).toStrictEqual({
      plan: "approved",
      question: "answered",
      queue: "removing",
    });
    const authoritative = store.refresh();
    reads[2]?.resolve(
      snapshot({
        cursor: 12,
        plans: [plan("superseded")],
        questions: [question("cancelled")],
        queue: [queueItem(3, "removed")],
      })
    );
    await expect(authoritative).resolves.toBeTruthy();
    const confirmed = store.getSnapshot().live;
    expect({
      plan: confirmed?.plans["plan-1"]?.status,
      question: confirmed?.questions["question-1"]?.status,
      queue: confirmed?.queue["queue-1"]?.state,
    }).toStrictEqual({
      plan: "superseded",
      question: "cancelled",
      queue: "removed",
    });
  });

  it("a gap does not advance the resume cursor until a covering snapshot arrives", async () => {
    const { reads, sources, store } = await ready();
    sources[0]?.send(event(12));
    await vi.advanceTimersByTimeAsync(16);
    expect(store.getSnapshot().live?.applied).toBe(10);
    reads[1]?.resolve(snapshot());
    await settle();
    expect(store.getSnapshot().live?.applied).toBe(10);
    const recovery = store.refresh();
    reads[2]?.resolve(snapshot({ cursor: 11 }));
    await expect(recovery).resolves.toBeTruthy();
    expect(store.getSnapshot().live?.applied).toBe(12);
    expect({ closed: sources[0]?.closed, url: sources[1]?.url }).toStrictEqual({
      closed: true,
      url: `/events?missionId=${MISSION_ID}&after=12`,
    });
  });

  it("expired cursors require a sufficiently recent snapshot and one stream replacement", async () => {
    const { reads, sources, store } = await ready();
    sources[0]?.emit(
      SSE_RESYNC,
      JSON.stringify({ oldestSeq: 30, reason: "cursor_expired" })
    );
    reads[1]?.resolve(snapshot({ cursor: 20 }));
    await settle();
    expect(store.getSnapshot().live?.applied).toBe(10);
    const recovery = store.refresh();
    reads[2]?.resolve(snapshot({ cursor: 30 }));
    await expect(recovery).resolves.toBeTruthy();
    expect(sources).toHaveLength(2);
    expect(sources.filter((source) => !source.closed)).toHaveLength(1);
    expect(sources[1]?.url).toContain("after=30");
  });

  it("owns single-flight pagination and rejects late pages/caller responses from a stopped generation", async () => {
    const page = deferred<{
      items: TranscriptItem[];
      nextCursor: string | null;
    }>();
    let signal: AbortSignal | undefined;
    const fetchTranscript = vi.fn<
      NonNullable<MissionStoreOptions["fetchTranscript"]>
    >((_id: string, _before: number, _limit: number, current: AbortSignal) => {
      signal = current;
      return page.promise;
    });
    const { reads, store } = await ready(
      { fetchTranscript },
      snapshot({
        transcript: [transcriptItem(3)],
        transcriptHasMore: true,
      })
    );
    const { generation } = store.getSnapshot();
    const loading = store.loadOlder();
    await expect(store.loadOlder()).resolves.toBeFalsy();
    expect(fetchTranscript).toHaveBeenCalledOnce();
    store.stop();
    store.start();
    reads[1]?.resolve(
      snapshot({ transcript: [transcriptItem(3)], transcriptHasMore: true })
    );
    await settle();
    page.resolve({ items: [transcriptItem(1)], nextCursor: null });
    await expect(loading).resolves.toBeFalsy();
    expect(signal?.aborted).toBeTruthy();
    store.applyLocal({ kind: "mission", value: mission(20) }, generation);
    store.prependTranscript([transcriptItem(0)], false, generation);
    expect({
      revision: store.getSnapshot().live?.mission.revision,
      transcript: Object.keys(store.getSnapshot().live?.transcript ?? {}),
    }).toStrictEqual({ revision: 1, transcript: ["t-3"] });
  });

  it("merges an overlapping page without replacing authoritative transcript items", async () => {
    const fetchTranscript = vi.fn<
      NonNullable<MissionStoreOptions["fetchTranscript"]>
    >(() =>
      Promise.resolve({
        items: [transcriptItem(1), transcriptItem(2, "Stale page copy")],
        nextCursor: null,
      })
    );
    const { store } = await ready(
      { fetchTranscript },
      snapshot({
        transcript: [transcriptItem(2, "Authoritative")],
        transcriptHasMore: true,
      })
    );
    await expect(store.loadOlder()).resolves.toBeTruthy();
    expect(store.getSnapshot().live?.transcript["t-2"]?.text).toBe(
      "Authoritative"
    );
    expect(store.getSnapshot().live?.transcriptHasMore).toBeFalsy();
  });

  it("fills transcript history between the loaded conversation and a disjoint reconnect tail", async () => {
    const fetchTranscript = vi.fn<
      NonNullable<MissionStoreOptions["fetchTranscript"]>
    >((_id: string, before: number) =>
      Promise.resolve({
        items: [transcriptItem(before - 2), transcriptItem(before - 1)],
        nextCursor: String(before - 2),
      })
    );
    const { reads, store } = await ready({ fetchTranscript });
    const refresh = store.refresh();
    reads[1]?.resolve(
      snapshot({
        cursor: 30,
        transcript: [transcriptItem(6), transcriptItem(7)],
        transcriptHasMore: true,
      })
    );
    await expect(refresh).resolves.toBeTruthy();
    expect(fetchTranscript.mock.calls.map((call) => call[1])).toStrictEqual([
      6, 4,
    ]);
    expect(
      Object.values(store.getSnapshot().live?.transcript ?? {})
        .map((item) => item.seq)
        .toSorted()
    ).toStrictEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(store.getSnapshot().live?.transcriptHasMore).toBeFalsy();
  });

  it("a refresh keeps active previews until a newer authoritative final supersedes them", async () => {
    const { reads, sources, store } = await ready();
    sources[0]?.send(
      event(11, {
        data: {
          agentId: "a-1",
          delta: "Draft",
          kind: "text",
          messageId: "stream-1",
        },
        type: "transcript.delta",
      })
    );
    await vi.advanceTimersByTimeAsync(16);
    const refresh = store.refresh();
    reads[1]?.resolve(snapshot({ cursor: 11 }));
    await expect(refresh).resolves.toBeTruthy();
    expect(store.getSnapshot().live?.previews["stream-1"]).toBeDefined();
    const final = store.refresh();
    reads[2]?.resolve(
      snapshot({ cursor: 12, transcript: [transcriptItem(2, "Final")] })
    );
    await expect(final).resolves.toBeTruthy();
    expect(store.getSnapshot().live?.previews).toStrictEqual({});
    expect(store.getSnapshot().live?.transcript["t-2"]?.text).toBe("Final");
  });
});
