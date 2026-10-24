import { FileMatchListSchema } from "@missions/protocol/composer";
import { routes } from "@missions/protocol/routes";
import type { Context, Hono } from "hono";

import type { FileSearch } from "../files/file-search";
import { badRequest, notFound } from "../lib/app-error";
import type { MissionService } from "../missions/mission-service";
import type { ProjectService } from "../projects/project-service";
import { param, reply } from "./json";

const query = (c: Context) => {
  const value = c.req.query("q") ?? "";
  if (value.length > 256 || value.includes("\0")) {
    throw badRequest("Invalid search query");
  }
  return value;
};

export const registerComposerRoutes = (
  app: Hono,
  missions: MissionService,
  projects: ProjectService,
  files: FileSearch
) => {
  app.get(routes.missionFileSearch(":missionId"), async (c) => {
    const { workspace } = missions.get(param(c, "missionId"));
    if (!workspace) {
      throw notFound("Mission folder");
    }
    return reply(c, FileMatchListSchema, {
      matches: await files.search(workspace.path, query(c)),
    });
  });
  app.get(routes.projectFileSearch(":projectId"), async (c) => {
    const project = projects.get(param(c, "projectId"));
    return reply(c, FileMatchListSchema, {
      matches: await files.search(project.path, query(c)),
    });
  });
};
