export const queryKeys = {
  branches: (projectId: string) => ["project", projectId, "branches"] as const,
  checkout: (projectId: string) => ["project", projectId, "checkout"] as const,
  cloneJob: (jobId: string) => ["clone", jobId] as const,
  connection: ["connection"] as const,
  fsBrowse: (path: string | undefined) => ["fs", path ?? "~"] as const,
  githubAuth: ["github", "auth"] as const,
  githubRepos: (q: string) => ["github", "repos", q] as const,
  missions: ["missions"] as const,
  models: ["models"] as const,
  projects: ["projects"] as const,
  settings: ["settings"] as const,
  worktrees: (projectId: string) =>
    ["project", projectId, "worktrees"] as const,
};
