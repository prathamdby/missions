import { SSE_RESYNC } from "@missions/protocol/http";
import type { MissionSummary } from "@missions/protocol/missions";
import type { Project } from "@missions/protocol/projects";
import type { Settings } from "@missions/protocol/settings";
import { QueryClient, QueryObserver } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { queryKeys } from "../api/query-keys";
import {
  applyGlobalEvent,
  applyMissionEvent,
  recoverQueryResources,
  upsertMissionSummary,
} from "./global-cache";
import { startGlobalSession } from "./global-session";
import {
  AT,
  deferred,
  event,
  mission,
  MISSION_ID,
  permission,
  settle,
  streamAdapter,
} from "./test-adapters";

const clients: QueryClient[] = [];
const cleanups: (() => void)[] = [];
const makeClient = () => {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  clients.push(client);
  return client;
};

const resources = [
  queryKeys.projects,
  queryKeys.missions,
  queryKeys.settings,
  queryKeys.models,
  queryKeys.connection,
  queryKeys.grants,
  queryKeys.pullRequests,
  queryKeys.cloneJob("clone-1"),
  queryKeys.githubAuth,
  queryKeys.githubRepos("missions"),
  queryKeys.branches("p-1"),
  queryKeys.worktrees("p-1"),
  queryKeys.checkout("p-1"),
  queryKeys.fsBrowse("/home"),
  queryKeys.changes(MISSION_ID),
  queryKeys.files(MISSION_ID, "src"),
  queryKeys.file(MISSION_ID, "src/main.ts"),
];

const seed = (client: QueryClient) => {
  for (const key of resources) {
    client.setQueryData(key, []);
  }
};

const project: Project = {
  createdAt: AT,
  defaultBranch: "main",
  id: "p-1",
  kind: "git",
  name: "Missions",
  path: "/home/missions",
  remoteUrl: null,
};

const settings: Settings = {
  cleanupAfterMerge: true,
  defaultAutonomy: "medium",
  maxConcurrentWorkers: 2,
  orchestrator: mission().orchestrator,
  worker: mission().worker,
  worktreeRoot: "/home/worktrees",
};

describe("global session and cache recovery", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    for (const cleanup of cleanups.splice(0)) {
      cleanup();
    }
    for (const client of clients.splice(0)) {
      client.clear();
    }
    vi.useRealTimers();
  });

  it.each(["gap", "reconnect", "resync"] as const)(
    "recovers every owned resource after %s",
    async (reason) => {
      const client = makeClient();
      seed(client);
      const transport = streamAdapter();
      const stop = startGlobalSession({
        client,
        eventsUrl: (after) => `/events?after=${after}`,
        openStream: transport.openStream,
      });
      cleanups.push(stop);
      transport.sources[0]?.emit("open");
      seed(client);
      transport.sources[0]?.send(event(10, undefined, null));
      await vi.advanceTimersByTimeAsync(16);
      if (reason === "gap") {
        transport.sources[0]?.send(event(12, undefined, null));
        await vi.advanceTimersByTimeAsync(16);
      } else if (reason === "reconnect") {
        transport.sources[0]?.emit("error");
        await vi.advanceTimersByTimeAsync(250);
        transport.sources[1]?.emit("open");
      } else {
        transport.sources[0]?.emit(
          SSE_RESYNC,
          JSON.stringify({ oldestSeq: 50, reason: "cursor_expired" })
        );
      }
      const expectedUrls = {
        gap: ["/events?after=undefined"],
        reconnect: ["/events?after=undefined", "/events?after=10"],
        resync: ["/events?after=undefined", "/events?after=undefined"],
      };
      expect(transport.sources.map((source) => source.url)).toStrictEqual(
        expectedUrls[reason]
      );
      expect(
        resources.every(
          (queryKey) => client.getQueryState(queryKey)?.isInvalidated
        )
      ).toBeTruthy();
    }
  );

  it("detects a gap inside the first batch and recovers reads on the first successful open", async () => {
    const client = makeClient();
    seed(client);
    const transport = streamAdapter();
    cleanups.push(
      startGlobalSession({
        client,
        eventsUrl: String,
        openStream: transport.openStream,
      })
    );
    transport.sources[0]?.emit("open");
    expect(
      resources.every((key) => client.getQueryState(key)?.isInvalidated)
    ).toBeTruthy();
    seed(client);
    transport.sources[0]?.send(
      event(10, undefined, null),
      event(12, undefined, null)
    );
    await vi.advanceTimersByTimeAsync(16);
    expect(
      resources.every((key) => client.getQueryState(key)?.isInvalidated)
    ).toBeTruthy();
  });

  it("deduplicates and orders global events and ignores callbacks after disposal", async () => {
    const client = makeClient();
    client.setQueryData(queryKeys.projects, []);
    const transport = streamAdapter();
    const stop = startGlobalSession({
      client,
      eventsUrl: String,
      openStream: transport.openStream,
    });
    cleanups.push(stop);
    const first = event(
      1,
      { data: { project }, type: "project.updated" },
      null
    );
    transport.sources[0]?.send(
      event(
        2,
        {
          data: { project: { ...project, name: "Newest" } },
          type: "project.updated",
        },
        null
      ),
      first,
      first
    );
    await vi.advanceTimersByTimeAsync(16);
    expect(client.getQueryData<Project[]>(queryKeys.projects)?.[0]?.name).toBe(
      "Newest"
    );
    expect(client.getQueryState(queryKeys.projects)?.isInvalidated).toBeFalsy();
    stop();
    transport.sources[0]?.send(
      event(
        3,
        { data: { projectId: project.id }, type: "project.removed" },
        null
      )
    );
    transport.sources[0]?.emit("open");
    await vi.advanceTimersByTimeAsync(1000);
    expect(client.getQueryData<Project[]>(queryKeys.projects)).toHaveLength(1);
    expect(transport.sources).toHaveLength(1);
  });

  it("central summary projection inserts, updates all fields and rejects older mission revisions", () => {
    const client = makeClient();
    client.setQueryData(queryKeys.pullRequests, []);
    expect(upsertMissionSummary(client, mission(3))).toBeTruthy();
    expect(upsertMissionSummary(client, mission(2))).toBeFalsy();
    expect(upsertMissionSummary(client, mission(3))).toBeFalsy();
    expect(
      client.getQueryData<MissionSummary[]>(queryKeys.missions)
    ).toStrictEqual([
      {
        createdAt: AT,
        id: MISSION_ID,
        projectId: "p-1",
        status: "running",
        title: "Mission revision 3",
        updatedAt: AT,
      },
    ]);
    expect(
      client.getQueryState(queryKeys.pullRequests)?.isInvalidated
    ).toBeTruthy();
  });

  it("late list and settings reads cannot overwrite newer event projections", async () => {
    const client = makeClient();
    client.setQueryData<MissionSummary[]>(queryKeys.missions, []);
    const oldList = deferred<MissionSummary[]>();
    let listSignal: AbortSignal | undefined;
    const reading = client.fetchQuery({
      queryFn: ({ signal }) => {
        listSignal = signal;
        return oldList.promise;
      },
      queryKey: queryKeys.missions,
      staleTime: 0,
    });
    const cancelled = reading.catch(() => null);
    upsertMissionSummary(client, mission(3));
    oldList.resolve([{ ...mission(1) }]);
    await cancelled;
    expect(listSignal?.aborted).toBeTruthy();
    expect(
      client.getQueryData<MissionSummary[]>(queryKeys.missions)?.[0]?.title
    ).toBe("Mission revision 3");

    const oldSettings = deferred<Settings>();
    const settingsRead = client.fetchQuery({
      queryFn: () => oldSettings.promise,
      queryKey: queryKeys.settings,
    });
    const settingsCancelled = settingsRead.catch(() => null);
    applyGlobalEvent(
      client,
      event(1, { data: { settings }, type: "settings.updated" }, null)
    );
    oldSettings.resolve({ ...settings, maxConcurrentWorkers: 1 });
    await settingsCancelled;
    expect(
      client.getQueryData<Settings>(queryKeys.settings)?.maxConcurrentWorkers
    ).toBe(2);
  });

  it("workspace invalidation keeps stable resource keys and protects in-flight old content", async () => {
    const client = makeClient();
    const key = queryKeys.file(MISSION_ID, "src/main.ts");
    const content = deferred<string>();
    let signal: AbortSignal | undefined;
    client.setQueryData(key, "Known content");
    const read = client.fetchQuery({
      queryFn: ({ signal: current }) => {
        signal = current;
        return content.promise;
      },
      queryKey: key,
      staleTime: 0,
    });
    const cancelled = read.catch(() => null);
    client.setQueryData(queryKeys.changes(MISSION_ID), []);
    client.setQueryData(queryKeys.files(MISSION_ID, "src"), []);
    for (let seq = 1; seq <= 100; seq += 1) {
      applyMissionEvent(client, event(seq));
    }
    content.resolve("Stale content");
    await cancelled;
    expect(signal?.aborted).toBeTruthy();
    expect(client.getQueryData(key)).toBe("Known content");
    expect(client.getQueryCache().getAll()).toHaveLength(3);
    expect(
      client
        .getQueryCache()
        .getAll()
        .every((query) => query.state.isInvalidated)
    ).toBeTruthy();
  });

  it("recovery refetches active readers, not just marking infinite-stale resources", async () => {
    const client = makeClient();
    const queryFn = vi.fn<() => Promise<string>>(() =>
      Promise.resolve("Recovered")
    );
    client.setQueryData(queryKeys.models, "Old");
    const observer = new QueryObserver(client, {
      queryFn,
      queryKey: queryKeys.models,
    });
    cleanups.push(observer.subscribe(() => {}));
    recoverQueryResources(client);
    await settle();
    expect(queryFn).toHaveBeenCalledOnce();
    expect(client.getQueryData(queryKeys.models)).toBe("Recovered");
  });

  it("permission and publish events invalidate grants, pull requests and project-derived reads", () => {
    const client = makeClient();
    seed(client);
    applyMissionEvent(
      client,
      event(11, {
        data: { request: permission("approved") },
        type: "permission.updated",
      })
    );
    expect(client.getQueryState(queryKeys.grants)?.isInvalidated).toBeTruthy();
    applyGlobalEvent(
      client,
      event(1, { data: { mission: mission(2) }, type: "mission.updated" }, null)
    );
    for (const key of [
      queryKeys.pullRequests,
      queryKeys.branches("p-1"),
      queryKeys.worktrees("p-1"),
      queryKeys.checkout("p-1"),
    ]) {
      expect(client.getQueryState(key)?.isInvalidated).toBeTruthy();
    }
  });
});
