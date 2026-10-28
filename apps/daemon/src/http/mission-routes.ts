import {
  AnswerQuestionRequestSchema,
  ChangeQueueModeRequestSchema,
  CommandAcceptedSchema,
  CreateMissionRequestSchema,
  DecidePermissionRequestSchema,
  DecidePlanRequestSchema,
  EditQueueItemRequestSchema,
  EditQueueItemResponseSchema,
  RewindTranscriptRequestSchema,
  MissionControlRequestSchema,
  RemoveQueueItemRequestSchema,
  RetryQueueItemRequestSchema,
  SubmitMessageRequestSchema,
  UpdateMissionRequestSchema,
} from "@missions/protocol/commands";
import { PageSchema } from "@missions/protocol/common";
import {
  MissionListSchema,
  MissionSchema,
  MissionSnapshotSchema,
  PermissionRequestSchema,
  PlanRevisionSchema,
  QueueItemSchema,
  QuestionSchema,
  TranscriptItemSchema,
} from "@missions/protocol/missions";
import { routes } from "@missions/protocol/routes";
import type { Hono } from "hono";

import { badRequest } from "../lib/app-error";
import type { MissionService } from "../missions/mission-service";
import { param, parseBody, reply } from "./json";

const M = ":missionId";
const TranscriptPageSchema = PageSchema(TranscriptItemSchema);

const intQuery = (raw: string | undefined, fallback: number | null) => {
  if (raw === undefined || raw === "") {
    return fallback;
  }
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0) {
    throw badRequest("Query values must be non-negative integers");
  }
  return value;
};

const id = (c: Parameters<typeof param>[0]) => param(c, "missionId");

export const registerMissionRoutes = (app: Hono, missions: MissionService) => {
  app.get(routes.missions(), (c) =>
    reply(c, MissionListSchema, {
      missions: missions.list(c.req.query("projectId")),
    })
  );
  app.post(routes.missions(), async (c) =>
    reply(
      c,
      MissionSnapshotSchema,
      await missions.create(await parseBody(c, CreateMissionRequestSchema)),
      201
    )
  );
  app.get(routes.mission(M), (c) =>
    reply(c, MissionSchema, missions.get(id(c)))
  );
  app.patch(routes.mission(M), async (c) =>
    reply(
      c,
      MissionSchema,
      await missions.update(
        id(c),
        await parseBody(c, UpdateMissionRequestSchema)
      )
    )
  );
  app.delete(routes.mission(M), async (c) =>
    reply(
      c,
      CommandAcceptedSchema,
      await missions.remove(
        id(c),
        await parseBody(c, MissionControlRequestSchema)
      )
    )
  );
  app.get(routes.missionSnapshot(M), (c) =>
    reply(c, MissionSnapshotSchema, missions.snapshot(id(c)))
  );
  app.get(routes.missionTranscript(M), (c) =>
    reply(
      c,
      TranscriptPageSchema,
      missions.transcript(
        id(c),
        intQuery(c.req.query("before"), null),
        intQuery(c.req.query("limit"), 100) ?? 100
      )
    )
  );
  app.post(routes.missionMessages(M), async (c) =>
    reply(
      c,
      QueueItemSchema,
      await missions.submitMessage(
        id(c),
        await parseBody(c, SubmitMessageRequestSchema)
      )
    )
  );
  app.patch(routes.queueItem(M, ":itemId"), async (c) =>
    reply(
      c,
      QueueItemSchema,
      await missions.changeQueueMode(
        id(c),
        param(c, "itemId"),
        await parseBody(c, ChangeQueueModeRequestSchema)
      )
    )
  );
  app.delete(routes.queueItem(M, ":itemId"), async (c) => {
    const body = await parseBody(c, RemoveQueueItemRequestSchema);
    return reply(
      c,
      QueueItemSchema,
      await missions.removeQueueItem(
        id(c),
        param(c, "itemId"),
        body.expectedRevision
      )
    );
  });
  app.post(routes.queueItemRetry(M, ":itemId"), async (c) =>
    reply(
      c,
      QueueItemSchema,
      await missions.retryQueueItem(
        id(c),
        param(c, "itemId"),
        await parseBody(c, RetryQueueItemRequestSchema)
      )
    )
  );
  app.post(routes.queueItemEdit(M, ":itemId"), async (c) =>
    reply(
      c,
      EditQueueItemResponseSchema,
      await missions.editQueueItem(
        id(c),
        param(c, "itemId"),
        await parseBody(c, EditQueueItemRequestSchema)
      )
    )
  );
  app.post(routes.transcriptRewind(M, ":itemId"), async (c) =>
    reply(
      c,
      MissionSchema,
      await missions.rewindTranscript(
        id(c),
        param(c, "itemId"),
        await parseBody(c, RewindTranscriptRequestSchema)
      )
    )
  );
  app.post(routes.permission(M, ":requestId"), async (c) =>
    reply(
      c,
      PermissionRequestSchema,
      missions.decidePermission(
        id(c),
        param(c, "requestId"),
        await parseBody(c, DecidePermissionRequestSchema)
      )
    )
  );
  app.post(routes.question(M, ":questionId"), async (c) =>
    reply(
      c,
      QuestionSchema,
      missions.answerQuestion(
        id(c),
        param(c, "questionId"),
        await parseBody(c, AnswerQuestionRequestSchema)
      )
    )
  );
  app.post(routes.plan(M), async (c) =>
    reply(
      c,
      PlanRevisionSchema,
      missions.decidePlan(id(c), await parseBody(c, DecidePlanRequestSchema))
    )
  );
  app.post(routes.missionPause(M), async (c) =>
    reply(
      c,
      MissionSchema,
      await missions.pause(
        id(c),
        await parseBody(c, MissionControlRequestSchema)
      )
    )
  );
  app.post(routes.missionArchive(M), async (c) =>
    reply(
      c,
      MissionSchema,
      await missions.archive(
        id(c),
        await parseBody(c, MissionControlRequestSchema)
      )
    )
  );
  app.post(routes.missionResume(M), async (c) =>
    reply(
      c,
      MissionSchema,
      await missions.resume(
        id(c),
        await parseBody(c, MissionControlRequestSchema)
      )
    )
  );
};
