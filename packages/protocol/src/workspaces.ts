import { z } from "zod";

import { IdSchema, TimestampSchema } from "./common";

export const WorkspaceModeSchema = z.enum([
  "new_worktree",
  "current_checkout",
  "existing_worktree",
]);
export type WorkspaceMode = z.infer<typeof WorkspaceModeSchema>;

export const WorkspaceRequestSchema = z.discriminatedUnion("mode", [
  z.strictObject({
    baseBranch: z.string().min(1).max(255),
    branchName: z.string().min(1).max(255).optional(),
    mode: z.literal("new_worktree"),
  }),
  z.strictObject({
    /** Required when the checkout has uncommitted changes. */
    acknowledgeDirty: z.boolean().default(false),
    mode: z.literal("current_checkout"),
  }),
  z.strictObject({
    acknowledgeDirty: z.boolean().default(false),
    mode: z.literal("existing_worktree"),
    path: z.string().min(1).max(4096),
  }),
]);
export type WorkspaceRequest = z.input<typeof WorkspaceRequestSchema>;

/** One persistent directory shared by every agent in a mission. */
export const WorkspaceBindingSchema = z.object({
  baseRef: z.string().nullable(),
  baselineDirtyFiles: z.array(z.string()),
  branch: z.string().nullable(),
  createdAt: TimestampSchema,
  id: IdSchema,
  missionId: IdSchema,
  mode: WorkspaceModeSchema,
  /** True only for worktrees the daemon created; cleanup never touches others. */
  owned: z.boolean(),
  path: z.string(),
  projectId: IdSchema,
  repoRoot: z.string(),
  startRevision: z.string().nullable(),
});
export type WorkspaceBinding = z.infer<typeof WorkspaceBindingSchema>;

export const WorktreeInfoSchema = z.object({
  branch: z.string().nullable(),
  dirty: z.boolean(),
  head: z.string().nullable(),
  isMain: z.boolean(),
  path: z.string(),
});
export const WorktreeListSchema = z.object({
  worktrees: z.array(WorktreeInfoSchema),
});
export type WorktreeInfo = z.infer<typeof WorktreeInfoSchema>;

export const CheckoutStatusSchema = z.object({
  branch: z.string().nullable(),
  dirty: z.boolean(),
  dirtyFiles: z.array(z.string()),
  path: z.string(),
});
export type CheckoutStatus = z.infer<typeof CheckoutStatusSchema>;
