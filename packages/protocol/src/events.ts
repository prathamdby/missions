import { z } from "zod";

import { IdSchema, TimestampSchema } from "./common";
import {
  AgentSchema,
  ArtifactSchema,
  AssignmentSchema,
  MissionSchema,
  OperationSchema,
  PermissionRequestSchema,
  PlanRevisionSchema,
  QueueItemSchema,
  QuestionSchema,
  TodoSchema,
  TranscriptItemSchema,
} from "./missions";
import { CloneJobSchema, ProjectSchema } from "./projects";
import { SettingsSchema } from "./settings";
import { apiPath } from "./version";

export const EVENTS_PATH = apiPath("/events");

export const NoticeSchema = z.object({
  code: z.enum([
    "rate_limited",
    "environment",
    "merge_conflict",
    "run_failed",
    "stop_failed",
    "external_change",
    "recovery_required",
    "info",
  ]),
  level: z.enum(["info", "warning", "error"]),
  message: z.string(),
  retryAfterMs: z.int().nonnegative().nullable(),
});
export type Notice = z.infer<typeof NoticeSchema>;

const eventData = <T extends string, S extends z.ZodType>(type: T, data: S) =>
  z.object({ data, type: z.literal(type) });

export const EventBodySchema = z.discriminatedUnion("type", [
  eventData("mission.updated", z.object({ mission: MissionSchema })),
  eventData("agent.updated", z.object({ agent: AgentSchema })),
  eventData("transcript.item", z.object({ item: TranscriptItemSchema })),
  eventData(
    "transcript.delta",
    z.object({
      agentId: IdSchema,
      delta: z.string(),
      kind: z.enum(["text", "thinking"]),
      messageId: z.string(),
    })
  ),
  eventData("plan.updated", z.object({ plan: PlanRevisionSchema })),
  eventData(
    "todos.updated",
    z.object({ agentId: IdSchema.nullable(), todos: z.array(TodoSchema) })
  ),
  eventData("assignment.updated", z.object({ assignment: AssignmentSchema })),
  eventData("question.updated", z.object({ question: QuestionSchema })),
  eventData(
    "permission.updated",
    z.object({ request: PermissionRequestSchema })
  ),
  eventData("queue.updated", z.object({ item: QueueItemSchema })),
  eventData("artifact.created", z.object({ artifact: ArtifactSchema })),
  eventData("workspace.changed", z.object({ paths: z.array(z.string()) })),
  eventData("operation.updated", z.object({ operation: OperationSchema })),
  eventData("notice", z.object({ notice: NoticeSchema })),
  eventData("project.updated", z.object({ project: ProjectSchema })),
  eventData("project.removed", z.object({ projectId: IdSchema })),
  /** Global: the mission's records and event stream are gone; its files stay on disk. */
  eventData("mission.removed", z.object({ missionId: IdSchema })),
  eventData("clone.updated", z.object({ job: CloneJobSchema })),
  eventData("settings.updated", z.object({ settings: SettingsSchema })),
]);
export type EventBody = z.infer<typeof EventBodySchema>;
export type EventType = EventBody["type"];

export const DaemonEventSchema = z.intersection(
  z.object({
    at: TimestampSchema,
    missionId: IdSchema.nullable(),
    /** Strictly increasing and gap-free within one stream: a mission, or global (`missionId: null`). */
    seq: z.int().positive(),
  }),
  EventBodySchema
);
export type DaemonEvent = z.infer<typeof DaemonEventSchema>;

/** Sent when the requested cursor is older than retained history. */
export const ResyncRequiredSchema = z.object({
  oldestSeq: z.int().nonnegative(),
  reason: z.literal("cursor_expired"),
});
