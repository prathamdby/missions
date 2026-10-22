import { z } from "zod";

import { IdSchema, OperationIdSchema, TimestampSchema } from "./common";

export const ProjectKindSchema = z.enum(["git", "directory"]);

export const ProjectSchema = z.object({
  createdAt: TimestampSchema,
  defaultBranch: z.string().nullable(),
  id: IdSchema,
  kind: ProjectKindSchema,
  name: z.string().min(1),
  path: z.string().min(1),
  remoteUrl: z.string().nullable(),
});
export type Project = z.infer<typeof ProjectSchema>;

export const ProjectListSchema = z.object({ projects: z.array(ProjectSchema) });

export const AddLocalProjectRequestSchema = z.strictObject({
  /** Explicit consent to run `git init` in a non-Git folder. */
  initializeGit: z.boolean().default(false),
  operationId: OperationIdSchema,
  path: z.string().min(1).max(4096),
});
export type AddLocalProjectRequest = z.input<
  typeof AddLocalProjectRequestSchema
>;

export const AddLocalProjectResponseSchema = z.discriminatedUnion("status", [
  z.object({ project: ProjectSchema, status: z.literal("added") }),
  z.object({ path: z.string(), status: z.literal("not_git") }),
]);
export type AddLocalProjectResponse = z.infer<
  typeof AddLocalProjectResponseSchema
>;

export const CloneSourceSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("github"),
    repo: z.string().regex(/^[\w.-]+\/[\w.-]+$/u, "Use owner/name"),
  }),
  z.strictObject({
    kind: z.literal("url"),
    url: z.string().min(1).max(2048),
  }),
]);
export type CloneSource = z.infer<typeof CloneSourceSchema>;

export const CloneProjectRequestSchema = z.strictObject({
  /** Parent directory; defaults to `~/.missions/repos`. */
  destinationParent: z.string().min(1).max(4096).optional(),
  operationId: OperationIdSchema,
  source: CloneSourceSchema,
});
export type CloneProjectRequest = z.infer<typeof CloneProjectRequestSchema>;

export const CloneJobStatusSchema = z.enum(["cloning", "succeeded", "failed"]);

export const CloneJobSchema = z.object({
  createdAt: TimestampSchema,
  destination: z.string(),
  error: z
    .object({
      code: z.enum([
        "auth_required",
        "not_found",
        "destination_exists",
        "network",
        "gh_missing",
        "failed",
      ]),
      message: z.string(),
    })
    .nullable(),
  id: IdSchema,
  progress: z.string().nullable(),
  projectId: IdSchema.nullable(),
  source: CloneSourceSchema,
  status: CloneJobStatusSchema,
});
export type CloneJob = z.infer<typeof CloneJobSchema>;

export const GithubAuthStatusSchema = z.object({
  host: z.string(),
  message: z.string().nullable(),
  state: z.enum(["signed_in", "signed_out", "gh_missing", "error"]),
  user: z.string().nullable(),
});
export type GithubAuthStatus = z.infer<typeof GithubAuthStatusSchema>;

export const GithubRepoSchema = z.object({
  description: z.string().nullable(),
  isPrivate: z.boolean(),
  nameWithOwner: z.string(),
  updatedAt: z.string().nullable(),
});
export const GithubRepoListSchema = z.object({
  repos: z.array(GithubRepoSchema),
});
export type GithubRepo = z.infer<typeof GithubRepoSchema>;

export const FsEntrySchema = z.object({
  isGitRepo: z.boolean(),
  name: z.string(),
  path: z.string(),
});
export const FsBrowseResponseSchema = z.object({
  entries: z.array(FsEntrySchema),
  parent: z.string().nullable(),
  path: z.string(),
});
export type FsBrowseResponse = z.infer<typeof FsBrowseResponseSchema>;

export const BranchSchema = z.object({
  current: z.boolean(),
  name: z.string(),
  remote: z.boolean(),
});
export const BranchListSchema = z.object({ branches: z.array(BranchSchema) });
export type Branch = z.infer<typeof BranchSchema>;
