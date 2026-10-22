import {
  AddLocalProjectRequestSchema,
  AddLocalProjectResponseSchema,
  BranchListSchema,
  CloneJobSchema,
  CloneProjectRequestSchema,
  FsBrowseResponseSchema,
  GithubAuthStatusSchema,
  GithubRepoListSchema,
  ProjectListSchema,
} from "@missions/protocol/projects";
import { routes } from "@missions/protocol/routes";
import {
  WorktreeListSchema,
  CheckoutStatusSchema,
} from "@missions/protocol/workspaces";
import type { Hono } from "hono";

import {
  browseFolder,
  githubAuth,
  githubRepos,
} from "../projects/project-service";
import type { ProjectService } from "../projects/project-service";
import { param, parseBody, reply } from "./json";

const P = ":projectId";
const J = ":jobId";

export const registerProjectRoutes = (app: Hono, projects: ProjectService) => {
  app.get(routes.projects(), (c) =>
    reply(c, ProjectListSchema, { projects: projects.list() })
  );
  app.post(routes.projects(), async (c) =>
    reply(
      c,
      AddLocalProjectResponseSchema,
      await projects.addLocal(await parseBody(c, AddLocalProjectRequestSchema))
    )
  );
  app.post(routes.clone(), async (c) =>
    reply(
      c,
      CloneJobSchema,
      await projects.clone(await parseBody(c, CloneProjectRequestSchema)),
      202
    )
  );
  app.get(routes.cloneJob(J), (c) =>
    reply(c, CloneJobSchema, projects.getCloneJob(param(c, "jobId")))
  );
  app.delete(routes.project(P), (c) => {
    projects.remove(param(c, "projectId"));
    return c.body(null, 204);
  });
  app.get(routes.projectBranches(P), async (c) =>
    reply(c, BranchListSchema, {
      branches: await projects.branches(param(c, "projectId")),
    })
  );
  app.get(routes.projectWorktrees(P), async (c) =>
    reply(c, WorktreeListSchema, {
      worktrees: await projects.worktrees(param(c, "projectId")),
    })
  );
  app.get(routes.projectCheckout(P), async (c) =>
    reply(
      c,
      CheckoutStatusSchema,
      await projects.checkout(param(c, "projectId"))
    )
  );
  app.get(routes.fsBrowse(), async (c) =>
    reply(c, FsBrowseResponseSchema, await browseFolder(c.req.query("path")))
  );
  app.get(routes.githubAuth(), async (c) =>
    reply(c, GithubAuthStatusSchema, await githubAuth())
  );
  app.get(routes.githubRepos(), async (c) =>
    reply(c, GithubRepoListSchema, {
      repos: await githubRepos(c.req.query("q")),
    })
  );
};
