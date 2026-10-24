import type { DaemonEvent } from "@missions/protocol/events";
import type { Mission, MissionSummary } from "@missions/protocol/missions";
import type { CloneJob, Project } from "@missions/protocol/projects";
import type { Settings } from "@missions/protocol/settings";
import type { QueryClient, QueryKey } from "@tanstack/react-query";

import { queryKeys } from "../api/query-keys";

export const upsertById = <T extends { id: string }>(
  list: readonly T[] | undefined,
  item: T
): T[] | undefined => {
  if (list === undefined) {
    return undefined;
  }
  return list.some((entry) => entry.id === item.id)
    ? list.map((entry) => (entry.id === item.id ? item : entry))
    : [...list, item];
};

/**
 * Cancellation is synchronous in QueryClient, even when a transport ignores
 * AbortSignal. Cancel before projecting/invalidation so late reads cannot
 * overwrite a newer event, and active readers restart from authoritative data.
 */
const invalidate = (client: QueryClient, queryKey?: QueryKey) => {
  void client.cancelQueries({ queryKey });
  void client.invalidateQueries({ queryKey });
};

const project = <T>(
  client: QueryClient,
  queryKey: QueryKey,
  update: (current: T | undefined) => T | undefined
) => {
  void client.cancelQueries({ exact: true, queryKey });
  client.setQueryData<T>(queryKey, update);
  if (client.getQueryData(queryKey) === undefined) {
    void client.invalidateQueries({ exact: true, queryKey });
  }
};

const removedMissions = new WeakMap<QueryClient, Set<string>>();
const removalListeners = new WeakMap<
  QueryClient,
  Set<(missionId: string) => void>
>();

export const isMissionRemoved = (client: QueryClient, missionId: string) =>
  removedMissions.get(client)?.has(missionId) ?? false;

/** Called once per removed mission, whether the DELETE response or the event came first. */
export const onMissionRemoved = (
  client: QueryClient,
  listener: (missionId: string) => void
) => {
  let listeners = removalListeners.get(client);
  if (!listeners) {
    listeners = new Set();
    removalListeners.set(client, listeners);
  }
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

/**
 * Deletion is terminal: drop every cached read for the mission and remember
 * the id so late snapshots, responses, and events cannot bring it back.
 */
export const removeMission = (client: QueryClient, missionId: string) => {
  let removed = removedMissions.get(client);
  if (!removed) {
    removed = new Set();
    removedMissions.set(client, removed);
  }
  if (removed.has(missionId)) {
    return;
  }
  removed.add(missionId);
  void client.cancelQueries({ queryKey: ["mission", missionId] });
  client.removeQueries({ queryKey: ["mission", missionId] });
  project<MissionSummary[]>(client, queryKeys.missions, (list) =>
    list?.filter((entry) => entry.id !== missionId)
  );
  invalidate(client, queryKeys.pullRequests);
  invalidate(client, ["project"]);
  for (const listener of removalListeners.get(client) ?? []) {
    listener(missionId);
  }
};

const missionVersions = new WeakMap<
  QueryClient,
  Map<
    string,
    {
      revision: number | undefined;
      updatedAt: string;
    }
  >
>();

/** Shared by creation, mission sessions, and global events. Inserts as well as updates. */
export const upsertMissionSummary = (
  client: QueryClient,
  mission: MissionSummary | Mission
): boolean => {
  if (isMissionRemoved(client, mission.id)) {
    return false;
  }
  let versions = missionVersions.get(client);
  if (!versions) {
    versions = new Map();
    missionVersions.set(client, versions);
  }
  const previous = versions.get(mission.id);
  const revision = "revision" in mission ? mission.revision : undefined;
  const cached = client
    .getQueryData<MissionSummary[]>(queryKeys.missions)
    ?.find((entry) => entry.id === mission.id);
  if (
    (previous &&
      revision !== undefined &&
      previous.revision !== undefined &&
      revision <= previous.revision) ||
    (revision === undefined &&
      previous &&
      mission.updatedAt <= previous.updatedAt) ||
    (cached && cached.updatedAt > mission.updatedAt)
  ) {
    return false;
  }
  versions.set(mission.id, { revision, updatedAt: mission.updatedAt });
  const summary: MissionSummary = {
    createdAt: mission.createdAt,
    id: mission.id,
    projectId: mission.projectId,
    status: mission.status,
    title: mission.title,
    updatedAt: mission.updatedAt,
  };
  const wasMissing = client.getQueryData(queryKeys.missions) === undefined;
  project<MissionSummary[]>(client, queryKeys.missions, (list) =>
    upsertById(list ?? [], summary)
  );
  if (wasMissing) {
    invalidate(client, queryKeys.missions);
  }
  invalidate(client, queryKeys.pullRequests);
  invalidate(client, ["project", mission.projectId]);
  invalidate(client, ["mission", mission.id]);
  return true;
};

/** Every query in this tab is daemon-owned, including inactive and infinite-stale reads. */
export const recoverQueryResources = (client: QueryClient) =>
  invalidate(client);

export const invalidateMissionResources = (
  client: QueryClient,
  missionId: string
) => {
  for (const queryKey of [
    ["mission", missionId],
    ["project"],
    queryKeys.missions,
    queryKeys.pullRequests,
    queryKeys.grants,
  ]) {
    invalidate(client, queryKey);
  }
};

export const applyMissionEvent = (client: QueryClient, event: DaemonEvent) => {
  if (event.missionId && isMissionRemoved(client, event.missionId)) {
    return;
  }
  if (event.type === "mission.updated") {
    upsertMissionSummary(client, event.data.mission);
  }
  if (event.type === "workspace.changed" && event.missionId) {
    invalidate(client, ["mission", event.missionId]);
    invalidate(client, ["project"]);
  }
  if (event.type === "permission.updated") {
    invalidate(client, queryKeys.grants);
  }
  if (event.type === "operation.updated") {
    invalidate(client, queryKeys.pullRequests);
  }
};

/** Writes a global event into the query cache and expires dependent reads. */
export const applyGlobalEvent = (client: QueryClient, event: DaemonEvent) => {
  switch (event.type) {
    case "project.updated": {
      project<Project[]>(client, queryKeys.projects, (list) =>
        upsertById(list, event.data.project)
      );
      invalidate(client, ["project", event.data.project.id]);
      break;
    }
    case "project.removed": {
      project<Project[]>(client, queryKeys.projects, (list) =>
        list?.filter((entry) => entry.id !== event.data.projectId)
      );
      for (const queryKey of [
        ["project", event.data.projectId],
        queryKeys.missions,
        queryKeys.pullRequests,
        queryKeys.grants,
      ]) {
        invalidate(client, queryKey);
      }
      break;
    }
    case "mission.removed": {
      removeMission(client, event.data.missionId);
      break;
    }
    case "clone.updated": {
      project<CloneJob>(
        client,
        queryKeys.cloneJob(event.data.job.id),
        () => event.data.job
      );
      if (event.data.job.status === "succeeded") {
        invalidate(client, queryKeys.projects);
        invalidate(client, ["project"]);
        invalidate(client, ["fs"]);
      }
      break;
    }
    case "settings.updated": {
      project<Settings>(client, queryKeys.settings, () => event.data.settings);
      for (const queryKey of [
        queryKeys.models,
        queryKeys.connection,
        ["github"],
        queryKeys.grants,
      ]) {
        invalidate(client, queryKey);
      }
      break;
    }
    default: {
      applyMissionEvent(client, event);
      break;
    }
  }
};
