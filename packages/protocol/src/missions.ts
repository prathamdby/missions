import { z } from "zod";

import {
  DeliveryModeSchema,
  ExecutionModeSchema,
  IdSchema,
  MessageOriginSchema,
  MessagePurposeSchema,
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

export const PullRequestSummarySchema = z.object({
  missionId: IdSchema,
  missionTitle: z.string(),
  pr: PullRequestStateSchema,
  projectId: IdSchema,
  updatedAt: TimestampSchema,
});
export type PullRequestSummary = z.infer<typeof PullRequestSummarySchema>;

export const PullRequestListSchema = z.object({
  pullRequests: z.array(PullRequestSummarySchema),
});
export type PullRequestList = z.infer<typeof PullRequestListSchema>;

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
  createdAt: TimestampSchema,
  /**
   * When the mission last became completed or failed; null while it can still
   * run. Defaults for records written before the field existed.
   */
  endedAt: TimestampSchema.nullable().default(null),
  /** Bumped by Pause; late results tagged with an older epoch are ignored. */
  epoch: z.int().nonnegative(),
  /** The mode the main agent currently runs in. Records before v2 default to Work. */
  executionMode: ExecutionModeSchema.default("work"),
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
  /** A requested mode transition that applies once earlier work is quiescent. */
  pendingExecutionMode: ExecutionModeSchema.nullable().default(null),
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

/** Why an agent is not producing output yet; shown instead of a bare spinner. */
export const WaitingReasonSchema = z.enum([
  "startup",
  "model",
  "permission",
  "answer",
  "write_lease",
  "retry",
  "reconnecting",
]);
export type WaitingReason = z.infer<typeof WaitingReasonSchema>;

export const AgentSchema = z.object({
  assignmentId: IdSchema.nullable(),
  createdAt: TimestampSchema,
  holdsWriteLease: z.boolean(),
  id: IdSchema,
  missionId: IdSchema,
  model: AgentModelSettingsSchema,
  /** Sessions this agent used before its current one, oldest first. */
  previousSessionIds: z.array(z.string()).default([]),
  /** Versioned system prompt of the current session; null marks a legacy session. */
  promptVersion: z.string().nullable().default(null),
  role: RoleSchema,
  sessionGeneration: z.int().nonnegative().default(0),
  sessionId: z.string().nullable(),
  status: AgentStatusSchema,
  title: z.string(),
  updatedAt: TimestampSchema,
  waitingReason: WaitingReasonSchema.nullable().default(null),
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
  /**
   * True only while a live native approval request is bound to this revision.
   * Pause, restart or session replacement clears it; legacy proposals never set it.
   */
  actionable: z.boolean().default(false),
  agentId: IdSchema.nullable().default(null),
  createdAt: TimestampSchema,
  decidedAt: TimestampSchema.nullable(),
  epoch: z.int().nonnegative().nullable().default(null),
  feedback: z.string().nullable(),
  guidanceVersion: z.string().nullable().default(null),
  id: IdSchema,
  markdown: z.string(),
  missionId: IdSchema,
  revision: z.int().positive(),
  sessionId: z.string().nullable().default(null),
  status: PlanStatusSchema,
  title: z.string(),
  /** Native ExitSpecMode tool use the approval answers. */
  toolUseId: z.string().nullable().default(null),
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
  /** Durably accepted and definitely not yet submitted to the native runner. */
  "accepted",
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

/** A mission agent as a message endpoint. */
export const MessagePartySchema = z.object({
  agentId: IdSchema,
  role: RoleSchema,
  title: z.string(),
});
export type MessageParty = z.infer<typeof MessagePartySchema>;

export const QueueItemSchema = z.object({
  /** The recipient agent. */
  agentId: IdSchema,
  createdAt: TimestampSchema,
  error: z.string().nullable(),
  /** Requested mode for the recipient's next work; null keeps the current mode. */
  executionMode: ExecutionModeSchema.nullable().default(null),
  /** Stable correlation ID, also used as the SDK request ID. */
  id: IdSchema,
  missionId: IdSchema,
  mode: DeliveryModeSchema,
  origin: MessageOriginSchema.default("user"),
  purpose: MessagePurposeSchema.default("message"),
  replacedById: IdSchema.nullable(),
  replacesId: IdSchema.nullable(),
  /** The failed or uncertain message this one explicitly retries. */
  retryOf: IdSchema.nullable().default(null),
  revision: RevisionSchema,
  /** Server-bound sender for agent messages; null for the user and the daemon. */
  sender: MessagePartySchema.nullable().default(null),
  /** Per-mission acceptance order; delivery to one recipient follows it. */
  sequence: z.int().nonnegative().default(0),
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
    /** One canonical record per agent-to-agent message, shown in both agents' views. */
    "agent_message",
  ]),
  missionId: IdSchema,
  purpose: MessagePurposeSchema.nullable().default(null),
  recipient: MessagePartySchema.nullable().default(null),
  /** Correlates a user message to its queue item when known. */
  requestId: z.string().nullable(),
  sender: MessagePartySchema.nullable().default(null),
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
export type MissionList = z.infer<typeof MissionListSchema>;
