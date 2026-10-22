import {
  CleanupRequestSchema,
  CommitRequestSchema,
  CreatePullRequestSchema,
  PushRequestSchema,
} from "@missions/protocol/commands";
import { MissionSchema } from "@missions/protocol/missions";
import { routes } from "@missions/protocol/routes";
import type { Hono } from "hono";

import type { GitService } from "../git/git-service";
import { param, parseBody, reply } from "./json";

const M = ":missionId";

export const registerPublishRoutes = (app: Hono, publish: GitService) => {
  app.post(routes.commit(M), async (c) =>
    reply(
      c,
      MissionSchema,
      await publish.commit(
        param(c, "missionId"),
        await parseBody(c, CommitRequestSchema)
      )
    )
  );
  app.post(routes.push(M), async (c) =>
    reply(
      c,
      MissionSchema,
      await publish.push(
        param(c, "missionId"),
        await parseBody(c, PushRequestSchema)
      )
    )
  );
  app.get(routes.pullRequest(M), async (c) =>
    reply(
      c,
      MissionSchema,
      await publish.refreshPullRequest(param(c, "missionId"))
    )
  );
  app.post(routes.pullRequest(M), async (c) =>
    reply(
      c,
      MissionSchema,
      await publish.createPullRequest(
        param(c, "missionId"),
        await parseBody(c, CreatePullRequestSchema)
      )
    )
  );
  app.post(routes.cleanup(M), async (c) =>
    reply(
      c,
      MissionSchema,
      await publish.cleanup(
        param(c, "missionId"),
        await parseBody(c, CleanupRequestSchema)
      )
    )
  );
};
