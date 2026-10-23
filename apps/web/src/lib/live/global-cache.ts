import type { DaemonEvent } from "@missions/protocol/events";
import type { MissionSummary } from "@missions/protocol/missions";
import type { CloneJob, Project } from "@missions/protocol/projects";
import type { Settings } from "@missions/protocol/settings";
import type { QueryClient } from "@tanstack/react-query";

import { queryKeys } from "@/lib/api/query-keys";

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

/** Writes a global (missionId: null) event into the query cache. */
export const applyGlobalEvent = (client: QueryClient, event: DaemonEvent) => {
  switch (event.type) {
    case "project.updated": {
      client.setQueryData<Project[]>(queryKeys.projects, (list) =>
        upsertById(list, event.data.project)
      );
      break;
    }
    case "project.removed": {
      client.setQueryData<Project[]>(queryKeys.projects, (list) =>
        list?.filter((project) => project.id !== event.data.projectId)
      );
      client.invalidateQueries({ queryKey: queryKeys.missions });
      break;
    }
    case "clone.updated": {
      client.setQueryData<CloneJob>(
        queryKeys.cloneJob(event.data.job.id),
        event.data.job
      );
      if (event.data.job.status === "succeeded") {
        client.invalidateQueries({ queryKey: queryKeys.projects });
      }
      break;
    }
    case "settings.updated": {
      client.setQueryData<Settings>(queryKeys.settings, event.data.settings);
      break;
    }
    case "mission.updated": {
      const { mission } = event.data;
      client.setQueryData<MissionSummary[]>(queryKeys.missions, (list) =>
        list?.map((entry) =>
          entry.id === mission.id
            ? {
                ...entry,
                status: mission.status,
                title: mission.title,
                updatedAt: mission.updatedAt,
              }
            : entry
        )
      );
      break;
    }
    default: {
      break;
    }
  }
};
