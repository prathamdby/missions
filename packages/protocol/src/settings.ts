import { z } from "zod";

import { AutonomySchema, IdSchema, ReasoningEffortSchema } from "./common";
import { AgentModelSettingsSchema, GrantSchema } from "./missions";

/** Where new missions run unless the user picks otherwise. */
export const DefaultWorkspaceModeSchema = z.enum([
  "new_worktree",
  "current_checkout",
]);
export type DefaultWorkspaceMode = z.infer<typeof DefaultWorkspaceModeSchema>;

export const SettingsSchema = z.object({
  cleanupAfterMerge: z.boolean(),
  defaultAutonomy: AutonomySchema,
  // Older daemons omit it; they always started in a new worktree.
  defaultWorkspaceMode: DefaultWorkspaceModeSchema.default("new_worktree"),
  maxConcurrentWorkers: z.int().min(1).max(8),
  orchestrator: AgentModelSettingsSchema,
  worker: AgentModelSettingsSchema,
  worktreeRoot: z.string().min(1),
});
export type Settings = z.infer<typeof SettingsSchema>;

export const UpdateSettingsRequestSchema = z.strictObject({
  cleanupAfterMerge: z.boolean().optional(),
  defaultAutonomy: AutonomySchema.optional(),
  defaultWorkspaceMode: DefaultWorkspaceModeSchema.optional(),
  maxConcurrentWorkers: z.int().min(1).max(8).optional(),
  orchestrator: AgentModelSettingsSchema.optional(),
  worker: AgentModelSettingsSchema.optional(),
  worktreeRoot: z.string().min(1).max(4096).optional(),
});
export type UpdateSettingsRequest = z.infer<typeof UpdateSettingsRequestSchema>;

export const ModelOptionSchema = z.object({
  defaultReasoningEffort: ReasoningEffortSchema.nullable(),
  displayName: z.string(),
  id: z.string(),
  supportedReasoningEfforts: z.array(ReasoningEffortSchema),
});
export type ModelOption = z.infer<typeof ModelOptionSchema>;

export const ModelListSchema = z.object({
  models: z.array(ModelOptionSchema),
  source: z.enum(["droid", "unavailable"]),
});
export type ModelList = z.infer<typeof ModelListSchema>;

export const ConnectionStatusSchema = z.object({
  daemon: z.object({
    startedAt: z.string(),
    url: z.string(),
    version: z.string(),
  }),
  droid: z.object({
    message: z.string().nullable(),
    state: z.enum(["ready", "missing", "error"]),
    version: z.string().nullable(),
  }),
  git: z.object({ version: z.string().nullable() }),
  github: z.object({
    message: z.string().nullable(),
    state: z.enum(["signed_in", "signed_out", "gh_missing", "error"]),
    user: z.string().nullable(),
  }),
});
export type ConnectionStatus = z.infer<typeof ConnectionStatusSchema>;

export const GrantListSchema = z.object({ grants: z.array(GrantSchema) });
export const RevokeGrantParamsSchema = z.object({ grantId: IdSchema });
