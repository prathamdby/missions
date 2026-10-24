import { apiPath } from "./version";

/** REST paths shared by the daemon, the web proxy, and tests. */
export const routes = {
  artifact: (missionId: string, artifactId: string) =>
    apiPath(`/missions/${missionId}/artifacts/${artifactId}`),
  attachment: (id: string) => apiPath(`/attachments/${id}`),
  attachments: () => apiPath("/attachments"),
  changes: (missionId: string) => apiPath(`/missions/${missionId}/changes`),
  cleanup: (missionId: string) => apiPath(`/missions/${missionId}/cleanup`),
  clone: () => apiPath("/projects/clone"),
  cloneJob: (jobId: string) => apiPath(`/projects/clone/${jobId}`),
  commit: (missionId: string) => apiPath(`/missions/${missionId}/commit`),
  connection: () => apiPath("/connection"),
  events: () => apiPath("/events"),
  file: (missionId: string) => apiPath(`/missions/${missionId}/file`),
  files: (missionId: string) => apiPath(`/missions/${missionId}/files`),
  fsBrowse: () => apiPath("/fs/browse"),
  githubAuth: () => apiPath("/github/auth"),
  githubRepos: () => apiPath("/github/repos"),
  grant: (grantId: string) => apiPath(`/grants/${grantId}`),
  grants: () => apiPath("/grants"),
  mission: (missionId: string) => apiPath(`/missions/${missionId}`),
  missionArchive: (missionId: string) =>
    apiPath(`/missions/${missionId}/archive`),
  missionAttachment: (missionId: string, attachmentId: string) =>
    apiPath(`/missions/${missionId}/attachments/${attachmentId}`),
  missionComposerCatalog: (missionId: string) =>
    apiPath(`/missions/${missionId}/composer-catalog`),
  missionFileSearch: (missionId: string) =>
    apiPath(`/missions/${missionId}/file-search`),
  missionMessages: (missionId: string) =>
    apiPath(`/missions/${missionId}/messages`),
  missionPause: (missionId: string) => apiPath(`/missions/${missionId}/pause`),
  missionResume: (missionId: string) =>
    apiPath(`/missions/${missionId}/resume`),
  missionSnapshot: (missionId: string) =>
    apiPath(`/missions/${missionId}/snapshot`),
  missionTranscript: (missionId: string) =>
    apiPath(`/missions/${missionId}/transcript`),
  missions: () => apiPath("/missions"),
  models: () => apiPath("/models"),
  permission: (missionId: string, requestId: string) =>
    apiPath(`/missions/${missionId}/permissions/${requestId}`),
  plan: (missionId: string) => apiPath(`/missions/${missionId}/plan`),
  project: (projectId: string) => apiPath(`/projects/${projectId}`),
  projectBranches: (projectId: string) =>
    apiPath(`/projects/${projectId}/branches`),
  projectCheckout: (projectId: string) =>
    apiPath(`/projects/${projectId}/checkout`),
  projectComposerCatalog: (projectId: string) =>
    apiPath(`/projects/${projectId}/composer-catalog`),
  projectFileSearch: (projectId: string) =>
    apiPath(`/projects/${projectId}/file-search`),
  projectWorktrees: (projectId: string) =>
    apiPath(`/projects/${projectId}/worktrees`),
  projects: () => apiPath("/projects"),
  pullRequest: (missionId: string) => apiPath(`/missions/${missionId}/pr`),
  pullRequests: () => apiPath("/pull-requests"),
  push: (missionId: string) => apiPath(`/missions/${missionId}/push`),
  question: (missionId: string, questionId: string) =>
    apiPath(`/missions/${missionId}/questions/${questionId}`),
  queueItem: (missionId: string, itemId: string) =>
    apiPath(`/missions/${missionId}/queue/${itemId}`),
  queueItemEdit: (missionId: string, itemId: string) =>
    apiPath(`/missions/${missionId}/queue/${itemId}/edit`),
  queueItemRetry: (missionId: string, itemId: string) =>
    apiPath(`/missions/${missionId}/queue/${itemId}/retry`),
  settings: () => apiPath("/settings"),
} as const;
