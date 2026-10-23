import type {
  Settings,
  UpdateSettingsRequest,
} from "@missions/protocol/settings";
import type { Query, QueryClient } from "@tanstack/react-query";

import { queryKeys } from "../../lib/api/query-keys";
import { SettingsCoordinator } from "./settings-coordinator";

/** Ordered writes may project only into the cache version they observed. */
export const createSettingsCoordinator = (
  client: QueryClient,
  {
    persist,
    onError,
  }: {
    persist: (patch: UpdateSettingsRequest) => Promise<Settings>;
    onError: (error: unknown) => void;
  }
) => {
  const filters = { exact: true, queryKey: queryKeys.settings };
  let observation: {
    query: Query | undefined;
    updates: number | undefined;
  } | null = null;

  return new SettingsCoordinator({
    commit: (settings) => {
      const query = client.getQueryCache().find(filters);
      if (
        observation === null ||
        query !== observation.query ||
        query?.state.dataUpdateCount !== observation.updates
      ) {
        // An event, another client, or a refetch changed the cache after
        // admission. Keep that state and reconcile with an authoritative read.
        void client.invalidateQueries(filters);
        return;
      }
      void client.cancelQueries(filters);
      client.setQueryData(queryKeys.settings, settings);
    },
    onError,
    persist: async (patch) => {
      await client.cancelQueries(filters);
      const query = client.getQueryCache().find(filters);
      observation = { query, updates: query?.state.dataUpdateCount };
      return await persist(patch);
    },
  });
};
