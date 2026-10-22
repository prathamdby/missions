import { z } from "zod";

import {
  AutonomySchema,
  DeliveryModeSchema,
  IdSchema,
  ReasoningEffortSchema,
  RevisionSchema,
  RoleSchema,
  TimestampSchema,
} from "./common";
import { WorkspaceBindingSchema } from "./workspaces";

export const MissionStatusSchema = z.enum([
  "setting_up",
  "exploring",
  "awaiting_approval",
  "running",
  "pausing",
  "paused",
  "stop_failed",
  "interrupted",
  "completed",
  "failed",
  "archived",
]);
export type MissionStatus = z.infer<typeof MissionStatusSchema>;

export const AgentModelSettingsSchema = z.object({
  modelId: z.string().min(1),
  reasoningEffort: ReasoningEffortSchema.nullable(),
});
export type AgentModelSettings = z.infer<typeof AgentModelSettingsSchema>;

export const PullRequestStateSchema = z.object({
  checks: z.enum(["none", "pending", "passing", "failing"]),
  isDraft: z.boolean(),
  number: z.int().positive(),
  state: z.enum(["open", "merged", "closed"]),
  updatedAt: TimestampSchema,
  url: z.string(),
});
export type PullRequestState = z.infer<typeof PullRequestStateSchema>;

export const PublishStateSchema = z.object({
  cleanup: z.enum(["none", "eligible", "removed", "kept", "blocked"]),
  cleanupReason: z.string().nullable(),
  commits: z.array(z.object({ message: z.string(), sha: z.string() })),
  pr: PullRequestStateSchema.nullable(),
  pushedBranch: z.string().nullable(),
  remote: z.string().nullable(),
});
export type PublishState = z.infer<typeof PublishStateSchema>;

export const MissionSchema = z.object({
  autonomy: AutonomySchema,
  createdAt: TimestampSchema,
  /** Bumped by Pause; late results tagged with an older epoch are ignored. */
  epoch: z.int().nonnegative(),
  goal: z.string(),
  id: IdSchema,
  lastError: z
    .object({
      code: z.string(),
      message: z.string(),
      retryAfterMs: z.int().nonnegative().nullable(),
    })
    .nullable(),
  orchestrator: AgentModelSettingsSchema,
  projectId: IdSchema,
  publish: PublishStateSchema,
  revision: RevisionSchema,
  status: MissionStatusSchema,
  summary: z.string().nullable(),
  title: z.string(),
  updatedAt: TimestampSchema,
  worker: AgentModelSettingsSchema,
  workspace: WorkspaceBindingSchema.nullable(),
});
export type Mission = z.infer<typeof MissionSchema>;

export const MissionSummarySchema = MissionSchema.pick({
  createdAt: true,
  id: true,
  projectId: true,
  status: true,
  title: true,
  updatedAt: true,
});
export type MissionSummary = z.infer<typeof MissionSummarySchema>;

export const AgentStatusSchema = z.enum([
  "starting",
  "idle",
  "working",
  "waiting_permission",
  "waiting_answer",
  "stopping",
  "stopped",
  "failed",
  "interrupted",
]);
export type AgentStatus = z.infer<typeof AgentStatusSchema>;

export const AgentSchema = z.object({
  assignmentId: IdSchema.nullable(),
  createdAt: TimestampSchema,
  holdsWriteLease: z.boolean(),
  id: IdSchema,
  missionId: IdSchema,
  model: AgentModelSettingsSchema,
  role: RoleSchema,
  sessionId: z.string().nullable(),
  status: AgentStatusSchema,
  title: z.string(),
  updatedAt: TimestampSchema,
  workingState: z.string().nullable(),
});
export type Agent = z.infer<typeof AgentSchema>;

export const PlanStatusSchema = z.enum([
  "proposed",
  "approved",
  "rejected",
  "superseded",
]);

export const PlanRevisionSchema = z.object({
  createdAt: TimestampSchema,
  decidedAt: TimestampSchema.nullable(),
  feedback: z.string().nullable(),
  id: IdSchema,
  markdown: z.string(),
  missionId: IdSchema,
  revision: z.int().positive(),
  status: PlanStatusSchema,
  title: z.string(),
});
export type PlanRevision = z.infer<typeof PlanRevisionSchema>;

export const TodoSchema = z.object({
  agentId: IdSchema.nullable(),
  content: z.string(),
  id: IdSchema,
  missionId: IdSchema,
  position: z.int().nonnegative(),
  priority: z.enum(["high", "medium", "low"]),
  status: z.enum(["pending", "in_progress", "completed"]),
});
export type Todo = z.infer<typeof TodoSchema>;

export const HandoffSchema = z.object({
  checks: z.array(z.object({ command: z.string(), outcome: z.string() })),
  filesChanged: z.array(z.string()),
  followUps: z.array(z.string()),
  summary: z.string(),
});
export type Handoff = z.infer<typeof HandoffSchema>;

export const AssignmentSchema = z.object({
  createdAt: TimestampSchema,
  epoch: z.int().nonnegative(),
  handoff: HandoffSchema.nullable(),
  id: IdSchema,
  instructions: z.string(),
  missionId: IdSchema,
  /** Writable assignments must hold the shared workspace lease to run. */
  needsWrite: z.boolean(),
  status: z.enum(["queued", "running", "handed_off", "failed", "cancelled"]),
  title: z.string(),
  updatedAt: TimestampSchema,
  workerAgentId: IdSchema.nullable(),
});
export type Assignment = z.infer<typeof AssignmentSchema>;

export const QuestionItemSchema = z.object({
  index: z.int().positive(),
  multiSelect: z.boolean(),
  options: z.array(z.string()),
  question: z.string(),
  topic: z.string(),
});
export type QuestionItem = z.infer<typeof QuestionItemSchema>;

export const QuestionAnswerSchema = z.object({
  answer: z.string(),
  index: z.int().positive(),
});

export const QuestionSchema = z.object({
  agentId: IdSchema,
  answers: z.array(QuestionAnswerSchema).nullable(),
  createdAt: TimestampSchema,
  epoch: z.int().nonnegative(),
  id: IdSchema,
  missionId: IdSchema,
  questions: z.array(QuestionItemSchema),
  status: z.enum(["pending", "answered", "cancelled"]),
});
export type Question = z.infer<typeof QuestionSchema>;

export const ToolUseSummarySchema = z.object({
  diff: z.string().nullable(),
  input: z.unknown(),
  summary: z.string(),
  toolName: z.string(),
  toolUseId: z.string().nullable(),
});
export type ToolUseSummary = z.infer<typeof ToolUseSummarySchema>;

export const PermissionKindSchema = z.enum(["tool", "publish"]);

export const PermissionDecisionSchema = z.enum([
  "approve_once",
  "always_allow",
  "deny",
]);
export type PermissionDecision = z.infer<typeof PermissionDecisionSchema>;

export const PermissionRequestSchema = z.object({
  agentId: IdSchema.nullable(),
  allowAlways: z.boolean(),
  createdAt: TimestampSchema,
  decidedAt: TimestampSchema.nullable(),
  decision: PermissionDecisionSchema.nullable(),
  epoch: z.int().nonnegative(),
  id: IdSchema,
  /** Mandatory gates never offer "Always allow". */
  kind: PermissionKindSchema,
  missionId: IdSchema,
  reason: z.string().nullable(),
  status: z.enum(["pending", "approved", "denied", "cancelled", "stale"]),
  toolUses: z.array(ToolUseSummarySchema),
});
export type PermissionRequest = z.infer<typeof PermissionRequestSchema>;

export const GrantSchema = z.object({
  action: z.string(),
  createdAt: TimestampSchema,
  id: IdSchema,
  normalizedRequest: z.string(),
  projectId: IdSchema,
  role: RoleSchema,
  workspacePath: z.string(),
});
export type Grant = z.infer<typeof GrantSchema>;

/**
 * UI/recovery mirror of a native queued message. The SDK runner owns delivery;
 * these states describe what the daemon has observed.
 */
export const QueueItemStateSchema = z.enum([
  "submitting",
  "queued",
  "sent",
  "removing",
  "removed",
  "discarded",
  "failed",
  "unknown",
]);
export type QueueItemState = z.infer<typeof QueueItemStateSchema>;

export const QueueItemSchema = z.object({
  agentId: IdSchema,
  createdAt: TimestampSchema,
  error: z.string().nullable(),
  /** Stable correlation ID, also used as the SDK request ID. */
  id: IdSchema,
  missionId: IdSchema,
  mode: DeliveryModeSchema,
  replacedById: IdSchema.nullable(),
  replacesId: IdSchema.nullable(),
  revision: RevisionSchema,
  state: QueueItemStateSchema,
  text: z.string(),
  updatedAt: TimestampSchema,
});
export type QueueItem = z.infer<typeof QueueItemSchema>;

export const OperationSchema = z.object({
  createdAt: TimestampSchema,
  detail: z.record(z.string(), z.unknown()),
  id: IdSchema,
  kind: z.string(),
  missionId: IdSchema.nullable(),
  status: z.enum(["intent", "succeeded", "failed", "unknown", "reconciled"]),
  updatedAt: TimestampSchema,
});
export type Operation = z.infer<typeof OperationSchema>;

export const ArtifactSchema = z.object({
  agentId: IdSchema.nullable(),
  createdAt: TimestampSchema,
  id: IdSchema,
  kind: z.enum(["image", "recording", "file"]),
  mediaType: z.string(),
  missionId: IdSchema,
  name: z.string(),
  size: z.int().nonnegative(),
});
export type Artifact = z.infer<typeof ArtifactSchema>;

export const TranscriptItemSchema = z.object({
  agentId: IdSchema,
  createdAt: TimestampSchema,
  id: IdSchema,
  isError: z.boolean(),
  kind: z.enum([
    "user",
    "assistant",
    "thinking",
    "tool_call",
    "tool_result",
    "system",
    "error",
  ]),
  missionId: IdSchema,
  /** Correlates a user message to its queue item when known. */
  requestId: z.string().nullable(),
  seq: z.int().nonnegative(),
  text: z.string(),
  toolInput: z.unknown().optional(),
  toolName: z.string().nullable(),
  toolUseId: z.string().nullable(),
});
export type TranscriptItem = z.infer<typeof TranscriptItemSchema>;

export const MissionSnapshotSchema = z.object({
  agents: z.array(AgentSchema),
  artifacts: z.array(ArtifactSchema),
  assignments: z.array(AssignmentSchema),
  /** Event sequence the snapshot reflects; subscribe with `after=cursor`. */
  cursor: z.int().nonnegative(),
  mission: MissionSchema,
  permissions: z.array(PermissionRequestSchema),
  plans: z.array(PlanRevisionSchema),
  questions: z.array(QuestionSchema),
  queue: z.array(QueueItemSchema),
  todos: z.array(TodoSchema),
  transcript: z.array(TranscriptItemSchema),
  transcriptHasMore: z.boolean(),
});
export type MissionSnapshot = z.infer<typeof MissionSnapshotSchema>;

export const MissionListSchema = z.object({
  missions: z.array(MissionSummarySchema),
});
