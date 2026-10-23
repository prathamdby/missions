import type {
  ChangeQueueModeRequest,
  CreateMissionRequest,
  DecidePermissionRequest,
  DecidePlanRequest,
  EditQueueItemRequest,
  MissionControlRequest,
  SubmitMessageRequest,
  UpdateMissionRequest,
  AnswerQuestionRequest,
} from "@missions/protocol/commands";
import { EditQueueItemResponseSchema } from "@missions/protocol/commands";
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
  ModelListSchema,
  SettingsSchema,
} from "@missions/protocol/settings";
import type { UpdateSettingsRequest } from "@missions/protocol/settings";
import {
  CheckoutStatusSchema,
  WorktreeListSchema,
} from "@missions/protocol/workspaces";

import { apiRequest, apiRequestVoid } from "@/lib/api/client";

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
  changeQueueMode: (
    missionId: string,
    itemId: string,
    body: ChangeQueueModeRequest
  ) =>
    apiRequest(routes.queueItem(missionId, itemId), QueueItemSchema, {
      body,
      method: "PATCH",
    }),
  checkout: (projectId: string) =>
    apiRequest(routes.projectCheckout(projectId), CheckoutStatusSchema),
  clone: (body: CloneProjectRequest) =>
    apiRequest(routes.clone(), CloneJobSchema, { body, method: "POST" }),
  cloneJob: (jobId: string) =>
    apiRequest(routes.cloneJob(jobId), CloneJobSchema),
  connection: () => apiRequest(routes.connection(), ConnectionStatusSchema),
  createMission: (body: CreateMissionRequest) =>
    apiRequest(routes.missions(), MissionSnapshotSchema, {
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
  fsBrowse: (path?: string) =>
    apiRequest(routes.fsBrowse(), FsBrowseResponseSchema, { query: { path } }),
  githubAuth: () => apiRequest(routes.githubAuth(), GithubAuthStatusSchema),
  githubRepos: (q?: string) =>
    apiRequest(routes.githubRepos(), GithubRepoListSchema, { query: { q } }),
  missionSnapshot: (missionId: string, signal?: AbortSignal) =>
    apiRequest(routes.missionSnapshot(missionId), MissionSnapshotSchema, {
      signal,
    }),
  missionTranscript: (missionId: string, before: number, limit: number) =>
    apiRequest(
      routes.missionTranscript(missionId),
      PageSchema(TranscriptItemSchema),
      { query: { before, limit } }
    ),
  missions: (projectId?: string) =>
    apiRequest(routes.missions(), MissionListSchema, { query: { projectId } }),
  models: () => apiRequest(routes.models(), ModelListSchema),
  pauseMission: (missionId: string, body: MissionControlRequest) =>
    apiRequest(routes.missionPause(missionId), MissionSchema, {
      body,
      method: "POST",
    }),
  projectBranches: (projectId: string) =>
    apiRequest(routes.projectBranches(projectId), BranchListSchema),
  projectWorktrees: (projectId: string) =>
    apiRequest(routes.projectWorktrees(projectId), WorktreeListSchema),
  projects: () => apiRequest(routes.projects(), ProjectListSchema),
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
  settings: () => apiRequest(routes.settings(), SettingsSchema),
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
