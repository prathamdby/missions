import { z } from "zod";

import {
  AutonomySchema,
  DeliveryModeSchema,
  IdSchema,
  OperationIdSchema,
  RevisionSchema,
} from "./common";
import {
  AgentModelSettingsSchema,
  PermissionDecisionSchema,
  QuestionAnswerSchema,
} from "./missions";
import { WorkspaceRequestSchema } from "./workspaces";

export const CreateMissionRequestSchema = z.strictObject({
  autonomy: AutonomySchema.optional(),
  goal: z.string().trim().min(1).max(20_000),
  operationId: OperationIdSchema,
  orchestrator: AgentModelSettingsSchema.optional(),
  projectId: IdSchema,
  title: z.string().trim().min(1).max(200).optional(),
  worker: AgentModelSettingsSchema.optional(),
  workspace: WorkspaceRequestSchema,
});
export type CreateMissionRequest = z.input<typeof CreateMissionRequestSchema>;

export const UpdateMissionRequestSchema = z.strictObject({
  autonomy: AutonomySchema.optional(),
  expectedRevision: RevisionSchema,
  title: z.string().trim().min(1).max(200).optional(),
});
export type UpdateMissionRequest = z.infer<typeof UpdateMissionRequestSchema>;

export const SubmitMessageRequestSchema = z.strictObject({
  /** Defaults to the Orchestrator. */
  agentId: IdSchema.optional(),
  mode: DeliveryModeSchema,
  operationId: OperationIdSchema,
  text: z.string().trim().min(1).max(100_000),
});
export type SubmitMessageRequest = z.infer<typeof SubmitMessageRequestSchema>;

export const ChangeQueueModeRequestSchema = z.strictObject({
  expectedRevision: RevisionSchema,
  mode: DeliveryModeSchema,
});
export type ChangeQueueModeRequest = z.infer<
  typeof ChangeQueueModeRequestSchema
>;

export const RemoveQueueItemRequestSchema = z.strictObject({
  expectedRevision: RevisionSchema,
});

export const EditQueueItemRequestSchema = z.strictObject({
  expectedRevision: RevisionSchema,
  operationId: OperationIdSchema,
  text: z.string().trim().min(1).max(100_000),
});
export type EditQueueItemRequest = z.infer<typeof EditQueueItemRequestSchema>;

export const EditQueueItemResponseSchema = z.object({
  /** "replaced": native delete confirmed and a new request was submitted. */
  outcome: z.enum(["replaced", "already_sent", "delete_unconfirmed"]),
  replacementId: IdSchema.nullable(),
});
export type EditQueueItemResponse = z.infer<typeof EditQueueItemResponseSchema>;

export const DecidePermissionRequestSchema = z.strictObject({
  decision: PermissionDecisionSchema,
  epoch: z.int().nonnegative(),
});
export type DecidePermissionRequest = z.infer<
  typeof DecidePermissionRequestSchema
>;

export const AnswerQuestionRequestSchema = z.strictObject({
  answers: z.array(QuestionAnswerSchema),
  cancelled: z.boolean().default(false),
  epoch: z.int().nonnegative(),
});
export type AnswerQuestionRequest = z.input<typeof AnswerQuestionRequestSchema>;

export const DecidePlanRequestSchema = z.strictObject({
  approve: z.boolean(),
  feedback: z.string().max(20_000).optional(),
  /** Approval binds to this exact plan revision. */
  planRevision: z.int().positive(),
});
export type DecidePlanRequest = z.infer<typeof DecidePlanRequestSchema>;

export const MissionControlRequestSchema = z.strictObject({
  expectedRevision: RevisionSchema,
  operationId: OperationIdSchema,
});
export type MissionControlRequest = z.infer<typeof MissionControlRequestSchema>;

export const CommitRequestSchema = z.strictObject({
  /** Hash of the reviewed change list; stale reviews are rejected. */
  expectedChangesHash: z.string().min(1),
  /** Must match the reviewed HEAD; a moved HEAD rejects the approval. */
  expectedHead: z.string().nullable(),
  /** Also commit files that had changes before the mission started. */
  includePreExisting: z.boolean().default(false),
  message: z.string().trim().min(1).max(5000),
  operationId: OperationIdSchema,
});
export type CommitRequest = z.input<typeof CommitRequestSchema>;

export const PushRequestSchema = z.strictObject({
  expectedHead: z.string().min(1),
  operationId: OperationIdSchema,
});
export type PushRequest = z.infer<typeof PushRequestSchema>;

export const CreatePullRequestSchema = z.strictObject({
  body: z.string().max(60_000),
  expectedHead: z.string().min(1),
  operationId: OperationIdSchema,
  title: z.string().trim().min(1).max(256),
});
export type CreatePullRequest = z.infer<typeof CreatePullRequestSchema>;

export const CleanupRequestSchema = z.strictObject({
  action: z.enum(["remove", "keep"]),
  /** Persist "always remove after merge" for future missions. */
  alwaysAfterMerge: z.boolean().default(false),
  operationId: OperationIdSchema,
});
export type CleanupRequest = z.input<typeof CleanupRequestSchema>;

export const CommandAcceptedSchema = z.object({
  operationId: z.string(),
  status: z.enum(["accepted", "duplicate"]),
});
export type CommandAccepted = z.infer<typeof CommandAcceptedSchema>;
