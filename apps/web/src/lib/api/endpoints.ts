import type {
  ChangeQueueModeRequest,
  CleanupRequest,
  CommitRequest,
  CreateMissionRequest,
  CreatePullRequest,
  PushRequest,
  DecidePermissionRequest,
  RetryQueueItemRequest,
  DecidePlanRequest,
  EditQueueItemRequest,
  MissionControlRequest,
  SubmitMessageRequest,
  UpdateMissionRequest,
  AnswerQuestionRequest,
} from "@missions/protocol/commands";
import { EditQueueItemResponseSchema } from "@missions/protocol/commands";
import { PageSchema } from "@missions/protocol/common";
import type { ComparisonMode } from "@missions/protocol/files";
import {
  ChangesSchema,
  FileContentSchema,
  FileTreeSchema,
} from "@missions/protocol/files";
import {
  MissionListSchema,
  MissionSchema,
  MissionSnapshotSchema,
  PullRequestListSchema,
  PermissionRequestSchema,
  PlanRevisionSchema,
  QueueItemSchema,
  QuestionSchema,
  TranscriptItemSchema,
} from "@missions/protocol/missions";
import {
  AddLocalProjectResponseSchema,
  BranchListSchema,
  CloneJobSchema,
  FsBrowseResponseSchema,
  GithubAuthStatusSchema,
  GithubRepoListSchema,
  ProjectListSchema,
} from "@missions/protocol/projects";
import type {
  AddLocalProjectRequest,
  CloneProjectRequest,
} from "@missions/protocol/projects";
import { routes } from "@missions/protocol/routes";
import {
  ConnectionStatusSchema,
  GrantListSchema,
  ModelListSchema,
  SettingsSchema,
} from "@missions/protocol/settings";
import type { UpdateSettingsRequest } from "@missions/protocol/settings";
import {
  CheckoutStatusSchema,
  WorktreeListSchema,
} from "@missions/protocol/workspaces";

import { apiRequest, apiRequestVoid, proxyUrl } from "./client";

/** Typed calls for every daemon route the web app uses. */
export const api = {
  addProject: (body: AddLocalProjectRequest) =>
    apiRequest(routes.projects(), AddLocalProjectResponseSchema, {
      body,
      method: "POST",
    }),
  answerQuestion: (
    missionId: string,
    questionId: string,
    body: AnswerQuestionRequest
  ) =>
    apiRequest(routes.question(missionId, questionId), QuestionSchema, {
      body,
      method: "POST",
    }),
  archiveMission: (missionId: string, body: MissionControlRequest) =>
    apiRequest(routes.missionArchive(missionId), MissionSchema, {
      body,
      method: "POST",
    }),
  /** Same-origin URL for `<img>`, `<video>`, and downloads. */
  artifactUrl: (missionId: string, artifactId: string) =>
    proxyUrl(routes.artifact(missionId, artifactId)),
  changeQueueMode: (
    missionId: string,
    itemId: string,
    body: ChangeQueueModeRequest
  ) =>
    apiRequest(routes.queueItem(missionId, itemId), QueueItemSchema, {
      body,
      method: "PATCH",
    }),
  changes: (missionId: string, signal?: AbortSignal, mode?: ComparisonMode) =>
    apiRequest(routes.changes(missionId), ChangesSchema, {
      query: { mode },
      signal,
    }),
  checkout: (projectId: string, signal?: AbortSignal) =>
    apiRequest(routes.projectCheckout(projectId), CheckoutStatusSchema, {
      signal,
    }),
  cleanup: (missionId: string, body: CleanupRequest) =>
    apiRequest(routes.cleanup(missionId), MissionSchema, {
      body,
      method: "POST",
    }),
  clone: (body: CloneProjectRequest) =>
    apiRequest(routes.clone(), CloneJobSchema, { body, method: "POST" }),
  cloneJob: (jobId: string, signal?: AbortSignal) =>
    apiRequest(routes.cloneJob(jobId), CloneJobSchema, { signal }),
  commit: (missionId: string, body: CommitRequest) =>
    apiRequest(routes.commit(missionId), MissionSchema, {
      body,
      method: "POST",
    }),
  connection: (signal?: AbortSignal) =>
    apiRequest(routes.connection(), ConnectionStatusSchema, { signal }),
  createMission: (body: CreateMissionRequest) =>
    apiRequest(routes.missions(), MissionSnapshotSchema, {
      body,
      method: "POST",
    }),
  createPullRequest: (missionId: string, body: CreatePullRequest) =>
    apiRequest(routes.pullRequest(missionId), MissionSchema, {
      body,
      method: "POST",
    }),
  decidePermission: (
    missionId: string,
    requestId: string,
    body: DecidePermissionRequest
  ) =>
    apiRequest(
      routes.permission(missionId, requestId),
      PermissionRequestSchema,
      {
        body,
        method: "POST",
      }
    ),
  decidePlan: (missionId: string, body: DecidePlanRequest) =>
    apiRequest(routes.plan(missionId), PlanRevisionSchema, {
      body,
      method: "POST",
    }),
  editQueueItem: (
    missionId: string,
    itemId: string,
    body: EditQueueItemRequest
  ) =>
    apiRequest(
      routes.queueItemEdit(missionId, itemId),
      EditQueueItemResponseSchema,
      {
        body,
        method: "POST",
      }
    ),
  file: (missionId: string, path: string, signal?: AbortSignal) =>
    apiRequest(routes.file(missionId), FileContentSchema, {
      query: { path },
      signal,
    }),
  files: (missionId: string, dir: string, signal?: AbortSignal) =>
    apiRequest(routes.files(missionId), FileTreeSchema, {
      query: { dir },
      signal,
    }),
  fsBrowse: (path?: string, signal?: AbortSignal) =>
    apiRequest(routes.fsBrowse(), FsBrowseResponseSchema, {
      query: { path },
      signal,
    }),
  githubAuth: (signal?: AbortSignal) =>
    apiRequest(routes.githubAuth(), GithubAuthStatusSchema, { signal }),
  githubRepos: (q?: string, signal?: AbortSignal) =>
    apiRequest(routes.githubRepos(), GithubRepoListSchema, {
      query: { q },
      signal,
    }),
  grants: (signal?: AbortSignal) =>
    apiRequest(routes.grants(), GrantListSchema, { signal }),
  missionSnapshot: (missionId: string, signal?: AbortSignal) =>
    apiRequest(routes.missionSnapshot(missionId), MissionSnapshotSchema, {
      signal,
    }),
  missionTranscript: (
    missionId: string,
    before: number,
    limit: number,
    signal?: AbortSignal
  ) =>
    apiRequest(
      routes.missionTranscript(missionId),
      PageSchema(TranscriptItemSchema),
      { query: { before, limit }, signal }
    ),
  missions: (projectId?: string, signal?: AbortSignal) =>
    apiRequest(routes.missions(), MissionListSchema, {
      query: { projectId },
      signal,
    }),
  models: (signal?: AbortSignal) =>
    apiRequest(routes.models(), ModelListSchema, { signal }),
  pauseMission: (missionId: string, body: MissionControlRequest) =>
    apiRequest(routes.missionPause(missionId), MissionSchema, {
      body,
      method: "POST",
    }),
  projectBranches: (projectId: string, signal?: AbortSignal) =>
    apiRequest(routes.projectBranches(projectId), BranchListSchema, { signal }),
  projectWorktrees: (projectId: string, signal?: AbortSignal) =>
    apiRequest(routes.projectWorktrees(projectId), WorktreeListSchema, {
      signal,
    }),
  projects: (signal?: AbortSignal) =>
    apiRequest(routes.projects(), ProjectListSchema, { signal }),
  pullRequest: (missionId: string, signal?: AbortSignal) =>
    apiRequest(routes.pullRequest(missionId), MissionSchema, { signal }),
  pullRequests: (signal?: AbortSignal) =>
    apiRequest(routes.pullRequests(), PullRequestListSchema, { signal }),
  push: (missionId: string, body: PushRequest) =>
    apiRequest(routes.push(missionId), MissionSchema, {
      body,
      method: "POST",
    }),
  removeProject: (projectId: string) =>
    apiRequestVoid(routes.project(projectId), { method: "DELETE" }),
  removeQueueItem: (
    missionId: string,
    itemId: string,
    expectedRevision: number
  ) =>
    apiRequest(routes.queueItem(missionId, itemId), QueueItemSchema, {
      body: { expectedRevision },
      method: "DELETE",
    }),
  resumeMission: (missionId: string, body: MissionControlRequest) =>
    apiRequest(routes.missionResume(missionId), MissionSchema, {
      body,
      method: "POST",
    }),
  retryQueueItem: (
    missionId: string,
    itemId: string,
    body: RetryQueueItemRequest
  ) =>
    apiRequest(routes.queueItemRetry(missionId, itemId), QueueItemSchema, {
      body,
      method: "POST",
    }),
  revokeGrant: (grantId: string) =>
    apiRequestVoid(routes.grant(grantId), { method: "DELETE" }),
  settings: (signal?: AbortSignal) =>
    apiRequest(routes.settings(), SettingsSchema, { signal }),
  sharedFile: (missionId: string, path: string, signal?: AbortSignal) =>
    apiRequest(routes.file(missionId), FileContentSchema, {
      query: { path, scope: "shared" },
      signal,
    }),
  sharedFiles: (missionId: string, dir: string, signal?: AbortSignal) =>
    apiRequest(routes.files(missionId), FileTreeSchema, {
      query: { dir, scope: "shared" },
      signal,
    }),
  submitMessage: (missionId: string, body: SubmitMessageRequest) =>
    apiRequest(routes.missionMessages(missionId), QueueItemSchema, {
      body,
      method: "POST",
    }),
  updateMission: (missionId: string, body: UpdateMissionRequest) =>
    apiRequest(routes.mission(missionId), MissionSchema, {
      body,
      method: "PATCH",
    }),
  updateSettings: (body: UpdateSettingsRequest) =>
    apiRequest(routes.settings(), SettingsSchema, { body, method: "PATCH" }),
};
