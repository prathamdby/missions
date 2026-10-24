import { SSE_EVENT, SSE_RESYNC } from "@missions/protocol/http";
import type { AgentModelSettings } from "@missions/protocol/missions";
import { routes } from "@missions/protocol/routes";
import { afterEach, describe, expect, it } from "vitest";

import { createDaemon } from "../daemon";
import type { Daemon } from "../daemon";
import { pollUntil } from "../lib/async";
import { FakeRuntime } from "../test/fake-runtime";
import { gitRepo, testConfig } from "../test/fixtures";

/**
 * Load benchmark for the durable event path: a long mission must still open
 * from a bounded snapshot and replay its history without gaps or duplicates.
 */
const MESSAGES = 20_000;
const LIVE_DURING_REPLAY = 50;
const MODEL: AgentModelSettings = { modelId: "fake", reasoningEffort: null };

const opened: Daemon[] = [];

const boot = async (retainEventsPerStream?: number) => {
  const runtimes: FakeRuntime[] = [];
  const daemon = await createDaemon({
    config: await testConfig(),
    createRuntime: (options) => {
      const runtime = new FakeRuntime(options);
      runtimes.push(runtime);
      return runtime;
    },
    retainEventsPerStream,
    version: "bench",
  });
  opened.push(daemon);
  const added = await daemon.projects.addLocal({
    operationId: "bench-project",
    path: await gitRepo("bench"),
  });
  if (added.status !== "added") {
    throw new Error("project not added");
  }
  const snapshot = await daemon.missions.create({
    goal: "Benchmark",
    operationId: "bench-mission",
    orchestrator: MODEL,
    projectId: added.project.id,
    worker: MODEL,
    workspace: { mode: "current_checkout" },
  });
  const orchestrator = await pollUntil(
    () => Promise.resolve(runtimes[0]),
    (runtime) => (runtime?.submitted.length ?? 0) > 0,
    Date.now() + 3000,
    10
  );
  if (!orchestrator) {
    throw new Error("orchestrator not started");
  }
  return { daemon, missionId: snapshot.mission.id, orchestrator };
};

const say = (runtime: FakeRuntime, index: number) =>
  runtime.emit({
    message: {
      id: `bench-${index}`,
      requestId: null,
      role: "assistant",
      sender: null,
      text: `Step ${index}: inspected the module and recorded what changed.`,
      thinking: "",
      toolResults: [],
      toolUses: [],
    },
    type: "message",
  });

interface Frame {
  event: string;
  id: number | null;
}

const readFrames = async (
  daemon: Daemon,
  query: string,
  done: (frames: Frame[]) => boolean,
  onOpen?: () => void
) => {
  const controller = new AbortController();
  const res = await daemon.app.request(`${routes.events()}?${query}`, {
    headers: {
      authorization: `Bearer ${daemon.token}`,
      host: "127.0.0.1:4317",
    },
    signal: controller.signal,
  });
  const reader = res.body?.getReader();
  if (!reader) {
    throw new Error("no body");
  }
  onOpen?.();
  const decoder = new TextDecoder();
  const frames: Frame[] = [];
  let buffer = "";
  const deadline = Date.now() + 60_000;
  while (!done(frames) && Date.now() < deadline) {
    // oxlint-disable-next-line no-await-in-loop -- frames must be read in order
    const chunk = await reader.read();
    if (chunk.done) {
      break;
    }
    buffer += decoder.decode(chunk.value, { stream: true });
    const blocks = buffer.split("\n\n");
    buffer = blocks.pop() ?? "";
    for (const block of blocks) {
      const event = /^event: (?<v>.+)$/mu.exec(block)?.groups?.v;
      if (event) {
        const id = /^id: (?<v>\d+)$/mu.exec(block)?.groups?.v;
        frames.push({ event, id: id ? Number(id) : null });
      }
    }
  }
  controller.abort();
  return frames;
};

const elapsed = (from: number) => Math.round(performance.now() - from);

describe("replay benchmark", () => {
  afterEach(async () => {
    await Promise.all(opened.splice(0).map((daemon) => daemon.close()));
  });

  it(`opens and replays a ${MESSAGES}-message mission within budget`, async () => {
    const { daemon, missionId, orchestrator } = await boot(100_000);

    const ingestStart = performance.now();
    for (let index = 0; index < MESSAGES; index += 1) {
      say(orchestrator, index);
    }
    const ingestMs = elapsed(ingestStart);

    const snapshotStart = performance.now();
    const snapshot = daemon.missions.snapshot(missionId);
    const snapshotMs = elapsed(snapshotStart);

    const { latest, oldest } = daemon.log.bounds(missionId);
    const target = latest + LIVE_DURING_REPLAY;
    const replayStart = performance.now();
    const frames = await readFrames(
      daemon,
      `missionId=${missionId}&after=0`,
      (found) => (found.at(-1)?.id ?? 0) >= target,
      () => {
        for (let index = 0; index < LIVE_DURING_REPLAY; index += 1) {
          say(orchestrator, MESSAGES + index);
        }
      }
    );
    const replayMs = elapsed(replayStart);

    const pageStart = performance.now();
    const older = daemon.missions.transcript(
      missionId,
      snapshot.transcript[0]?.seq ?? null,
      500
    );
    const pageMs = elapsed(pageStart);

    console.info(
      `[replay-bench] messages=${MESSAGES} events=${latest} ingest=${ingestMs}ms snapshot=${snapshotMs}ms replay=${replayMs}ms (${Math.round((frames.length / Math.max(replayMs, 1)) * 1000)} ev/s) page500=${pageMs}ms`
    );
    expect({
      cursorMatchesLog: snapshot.cursor === latest,
      frameTypes: [...new Set(frames.map((frame) => frame.event))],
      lastText: snapshot.transcript.at(-1)?.text.split(":")[0],
      olderPage: older.items.length,
      submissions: orchestrator.submitted.length,
      transcript: snapshot.transcript.length,
      transcriptHasMore: snapshot.transcriptHasMore,
    }).toStrictEqual({
      cursorMatchesLog: true,
      frameTypes: [SSE_EVENT],
      lastText: `Step ${MESSAGES - 1}`,
      olderPage: 500,
      submissions: 1,
      transcript: 200,
      transcriptHasMore: true,
    });
    expect(frames.map((frame) => frame.id)).toStrictEqual(
      Array.from({ length: target - oldest + 1 }, (_, i) => oldest + i)
    );
    expect({
      page: pageMs < 250,
      replay: replayMs < 30_000,
      snapshot: snapshotMs < 250,
    }).toStrictEqual({ page: true, replay: true, snapshot: true });
  }, 120_000);

  it("keeps history bounded and tells stale cursors to resync", async () => {
    const { daemon, missionId, orchestrator } = await boot(1000);
    for (let index = 0; index < 5000; index += 1) {
      say(orchestrator, index);
    }
    const { latest, oldest } = daemon.log.bounds(missionId);
    expect(latest - oldest).toBeLessThan(2000);
    const frames = await readFrames(
      daemon,
      `missionId=${missionId}&after=1`,
      (found) => found.length > 0
    );
    expect(frames).toStrictEqual([{ event: SSE_RESYNC, id: null }]);
    expect(daemon.missions.snapshot(missionId).transcript).toHaveLength(200);
  }, 60_000);
});
