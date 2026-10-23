import { PullRequestListSchema } from "@missions/protocol/missions";
import type { PullRequestSummary } from "@missions/protocol/missions";
import { routes } from "@missions/protocol/routes";
import type { Hono } from "hono";

import type { Store } from "../db/store";
import { reply } from "./json";

/** Read-only projection: no mission snapshots, SDK sessions, or GitHub calls. */
export const registerPullRequestRoutes = (app: Hono, store: Store) => {
  app.get(routes.pullRequests(), (c) => {
    const pullRequests: PullRequestSummary[] = [];
    for (const mission of store.listMissions()) {
      if (mission.publish.pr) {
        pullRequests.push({
          missionId: mission.id,
          missionTitle: mission.title,
          pr: mission.publish.pr,
          projectId: mission.projectId,
          updatedAt: mission.updatedAt,
        });
      }
    }
    pullRequests.sort(
      (left, right) =>
        Date.parse(right.updatedAt) - Date.parse(left.updatedAt) ||
        left.missionId.localeCompare(right.missionId)
    );
    return reply(c, PullRequestListSchema, { pullRequests });
  });
};
