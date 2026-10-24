import type { Settings } from "@missions/protocol/settings";
import { QueryClient, QueryObserver } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";

import { queryKeys } from "../../lib/api/query-keys";
import { createSettingsCoordinator } from "./settings-cache";

const initial: Settings = {
  cleanupAfterMerge: false,
  defaultAutonomy: "medium",
  defaultWorkspaceMode: "new_worktree",
  maxConcurrentWorkers: 2,
  orchestrator: { modelId: "planner", reasoningEffort: "high" },
  worker: { modelId: "builder", reasoningEffort: null },
  worktreeRoot: "/worktrees",
};

const setup = () => {
  const client = new QueryClient();
  client.setQueryData(queryKeys.settings, initial);
  const admitted = Promise.withResolvers<undefined>();
  const response = Promise.withResolvers<Settings>();
  const errors: unknown[] = [];
  const coordinator = createSettingsCoordinator(client, {
    onError: (error) => errors.push(error),
    persist: () => {
      admitted.resolve(undefined);
      return response.promise;
    },
  });
  return { admitted, client, coordinator, errors, response };
};

describe("settings cache persistence", () => {
  it("keeps a newer event over a late successful response and refetches authoritative settings", async () => {
    const { admitted, client, coordinator, errors, response } = setup();
    const refetchStarted = Promise.withResolvers<undefined>();
    const authoritative = Promise.withResolvers<Settings>();
    const reconciled = Promise.withResolvers<undefined>();
    let reads = 0;
    const observer = new QueryObserver(client, {
      queryFn: () => {
        reads += 1;
        refetchStarted.resolve(undefined);
        return authoritative.promise;
      },
      queryKey: queryKeys.settings,
      retry: false,
      staleTime: Infinity,
    });
    const unsubscribe = observer.subscribe((result) => {
      if (result.data?.worktreeRoot === "/authoritative") {
        reconciled.resolve(undefined);
      }
    });
    try {
      const pending = coordinator.save({ defaultAutonomy: "high" });
      await admitted.promise;
      const newer = { ...initial, worktreeRoot: "/newer-event" };
      client.setQueryData(queryKeys.settings, newer);
      response.resolve({ ...initial, defaultAutonomy: "high" });
      await expect(pending).resolves.toBeTruthy();
      await refetchStarted.promise;
      expect({
        cached: client.getQueryData(queryKeys.settings),
        errors,
        reads,
      }).toStrictEqual({ cached: newer, errors: [], reads: 1 });
      authoritative.resolve({
        ...newer,
        defaultAutonomy: "high",
        worktreeRoot: "/authoritative",
      });
      await reconciled.promise;
      expect(client.getQueryData(queryKeys.settings)).toStrictEqual({
        ...newer,
        defaultAutonomy: "high",
        worktreeRoot: "/authoritative",
      });
    } finally {
      unsubscribe();
      client.clear();
    }
  });

  it("projects a successful response when the observed cache has not changed", async () => {
    const { admitted, client, coordinator, errors, response } = setup();
    try {
      const pending = coordinator.save({ defaultAutonomy: "high" });
      await admitted.promise;
      const saved = { ...initial, defaultAutonomy: "high" as const };
      response.resolve(saved);
      await expect(pending).resolves.toBeTruthy();
      expect({
        cached: client.getQueryData(queryKeys.settings),
        errors,
        invalidated: client.getQueryState(queryKeys.settings)?.isInvalidated,
        pending: coordinator.getSnapshot(),
      }).toStrictEqual({
        cached: saved,
        errors: [],
        invalidated: false,
        pending: false,
      });
    } finally {
      client.clear();
    }
  });
});
