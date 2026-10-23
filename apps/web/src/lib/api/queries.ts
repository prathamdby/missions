"use client";

import type { ComparisonMode } from "@missions/protocol/files";
import { keepPreviousData, useQuery } from "@tanstack/react-query";

import { isApiError } from "./api-error";
import { api } from "./endpoints";
import { queryKeys } from "./query-keys";

const MISSIONS_POLL_MS = 15_000;
const CLONE_POLL_MS = 1500;

export const useProjects = () =>
  useQuery({
    queryFn: async ({ signal }) => {
      const response = await api.projects(signal);
      return response.projects;
    },
    queryKey: queryKeys.projects,
  });

/**
 * Polling is a fallback for changes made while no live stream was connected.
 */
export const useMissions = () =>
  useQuery({
    queryFn: async ({ signal }) => {
      const response = await api.missions(undefined, signal);
      return response.missions;
    },
    queryKey: queryKeys.missions,
    refetchInterval: MISSIONS_POLL_MS,
  });

export const useSettings = () =>
  useQuery({
    queryFn: ({ signal }) => api.settings(signal),
    queryKey: queryKeys.settings,
  });

export const useConnectionStatus = () =>
  useQuery({
    queryFn: ({ signal }) => api.connection(signal),
    queryKey: queryKeys.connection,
  });

export const useModels = () =>
  useQuery({
    queryFn: ({ signal }) => api.models(signal),
    queryKey: queryKeys.models,
    staleTime: Infinity,
  });

/** A model's display name, falling back to its ID until the list loads. */
export const useModelName = (modelId: string) => {
  const models = useModels();
  return (
    models.data?.models.find((model) => model.id === modelId)?.displayName ??
    modelId
  );
};

export const useGrants = () =>
  useQuery({
    queryFn: async ({ signal }) => {
      const response = await api.grants(signal);
      return response.grants;
    },
    queryKey: queryKeys.grants,
  });

/**
 * Resource identity is stable. The session invalidates these resources on
 * workspace events/recovery instead of retaining one cache entry per event.
 */
export const useChanges = (
  missionId: string,
  _workspaceSeq: number,
  enabled = true,
  mode?: ComparisonMode
) =>
  useQuery({
    enabled,
    placeholderData: mode === undefined ? keepPreviousData : undefined,
    queryFn: ({ signal }) =>
      mode === undefined
        ? api.changes(missionId, signal)
        : api.changes(missionId, signal, mode),
    queryKey: mode
      ? [...queryKeys.changes(missionId), mode]
      : queryKeys.changes(missionId),
  });

export const useFileTree = (
  missionId: string,
  dir: string,
  _workspaceSeq: number,
  enabled = true
) =>
  useQuery({
    enabled,
    placeholderData: keepPreviousData,
    queryFn: ({ signal }) => api.files(missionId, dir, signal),
    queryKey: queryKeys.files(missionId, dir),
  });

export const useFileContent = (
  missionId: string,
  path: string | null,
  _workspaceSeq: number
) =>
  useQuery({
    enabled: path !== null,
    queryFn: ({ signal }) => api.file(missionId, path ?? "", signal),
    queryKey: queryKeys.file(missionId, path ?? ""),
    retry: false,
  });

export const useSharedFiles = (missionId: string, dir: string) =>
  useQuery({
    queryFn: ({ signal }) => api.sharedFiles(missionId, dir, signal),
    queryKey: [...queryKeys.files(missionId, "shared"), dir],
    refetchInterval: MISSIONS_POLL_MS,
  });

export const useSharedFile = (missionId: string, path: string) =>
  useQuery({
    queryFn: ({ signal }) => api.sharedFile(missionId, path, signal),
    queryKey: [...queryKeys.file(missionId, "shared"), path],
    refetchInterval: MISSIONS_POLL_MS,
  });

export const useBranches = (projectId: string | null, enabled = true) =>
  useQuery({
    enabled: projectId !== null && enabled,
    queryFn: async ({ signal }) => {
      const response = await api.projectBranches(projectId ?? "", signal);
      return response.branches;
    },
    queryKey: queryKeys.branches(projectId ?? ""),
  });

export const useWorktrees = (projectId: string | null, enabled = true) =>
  useQuery({
    enabled: projectId !== null && enabled,
    queryFn: async ({ signal }) => {
      const response = await api.projectWorktrees(projectId ?? "", signal);
      return response.worktrees;
    },
    queryKey: queryKeys.worktrees(projectId ?? ""),
  });

export const useCheckout = (projectId: string | null, enabled = true) =>
  useQuery({
    enabled: projectId !== null && enabled,
    queryFn: ({ signal }) => api.checkout(projectId ?? "", signal),
    queryKey: queryKeys.checkout(projectId ?? ""),
  });

export const useFsBrowse = (path: string | undefined, enabled = true) =>
  useQuery({
    enabled,
    queryFn: ({ signal }) => api.fsBrowse(path, signal),
    queryKey: queryKeys.fsBrowse(path),
  });

export const useGithubAuth = (enabled = true) =>
  useQuery({
    enabled,
    queryFn: ({ signal }) => api.githubAuth(signal),
    queryKey: queryKeys.githubAuth,
    staleTime: 0,
  });

export const useGithubRepos = (q: string, enabled: boolean) =>
  useQuery({
    enabled,
    queryFn: async ({ signal }) => {
      const response = await api.githubRepos(q || undefined, signal);
      return response.repos;
    },
    queryKey: queryKeys.githubRepos(q),
    retry: (count, error) =>
      !(isApiError(error) && error.code === "unauthorized") && count < 1,
  });

export const useCloneJob = (jobId: string | null) =>
  useQuery({
    enabled: jobId !== null,
    queryFn: ({ signal }) => api.cloneJob(jobId ?? "", signal),
    queryKey: queryKeys.cloneJob(jobId ?? ""),
    refetchInterval: (query) =>
      query.state.data?.status === "cloning" || query.state.data === undefined
        ? CLONE_POLL_MS
        : false,
  });

export const usePullRequestsQuery = () =>
  useQuery({
    queryFn: async ({ signal }) => {
      const response = await api.pullRequests(signal);
      return response.pullRequests;
    },
    queryKey: queryKeys.pullRequests,
  });
