"use client";

import { useQuery } from "@tanstack/react-query";

import { isApiError } from "@/lib/api/api-error";
import { api } from "@/lib/api/endpoints";
import { queryKeys } from "@/lib/api/query-keys";

const MISSIONS_POLL_MS = 15_000;
const CLONE_POLL_MS = 1500;

export const useProjects = () =>
  useQuery({
    queryFn: async () => {
      const response = await api.projects();
      return response.projects;
    },
    queryKey: queryKeys.projects,
  });

/**
 * Mission events only arrive on per-mission streams, so the sidebar list polls
 * to pick up status changes of missions that are not open.
 */
export const useMissions = () =>
  useQuery({
    queryFn: async () => {
      const response = await api.missions();
      return response.missions;
    },
    queryKey: queryKeys.missions,
    refetchInterval: MISSIONS_POLL_MS,
  });

export const useSettings = () =>
  useQuery({ queryFn: api.settings, queryKey: queryKeys.settings });

export const useConnectionStatus = () =>
  useQuery({ queryFn: api.connection, queryKey: queryKeys.connection });

export const useModels = () =>
  useQuery({
    queryFn: api.models,
    queryKey: queryKeys.models,
    staleTime: Infinity,
  });

export const useBranches = (projectId: string | null, enabled = true) =>
  useQuery({
    enabled: projectId !== null && enabled,
    queryFn: async () => {
      const response = await api.projectBranches(projectId ?? "");
      return response.branches;
    },
    queryKey: queryKeys.branches(projectId ?? ""),
  });

export const useWorktrees = (projectId: string | null, enabled = true) =>
  useQuery({
    enabled: projectId !== null && enabled,
    queryFn: async () => {
      const response = await api.projectWorktrees(projectId ?? "");
      return response.worktrees;
    },
    queryKey: queryKeys.worktrees(projectId ?? ""),
  });

export const useCheckout = (projectId: string | null, enabled = true) =>
  useQuery({
    enabled: projectId !== null && enabled,
    queryFn: () => api.checkout(projectId ?? ""),
    queryKey: queryKeys.checkout(projectId ?? ""),
  });

export const useFsBrowse = (path: string | undefined, enabled = true) =>
  useQuery({
    enabled,
    queryFn: () => api.fsBrowse(path),
    queryKey: queryKeys.fsBrowse(path),
  });

export const useGithubAuth = (enabled = true) =>
  useQuery({
    enabled,
    queryFn: api.githubAuth,
    queryKey: queryKeys.githubAuth,
    staleTime: 0,
  });

export const useGithubRepos = (q: string, enabled: boolean) =>
  useQuery({
    enabled,
    queryFn: async () => {
      const response = await api.githubRepos(q || undefined);
      return response.repos;
    },
    queryKey: queryKeys.githubRepos(q),
    retry: (count, error) =>
      !(isApiError(error) && error.code === "unauthorized") && count < 1,
  });

export const useCloneJob = (jobId: string | null) =>
  useQuery({
    enabled: jobId !== null,
    queryFn: () => api.cloneJob(jobId ?? ""),
    queryKey: queryKeys.cloneJob(jobId ?? ""),
    refetchInterval: (query) =>
      query.state.data?.status === "cloning" || query.state.data === undefined
        ? CLONE_POLL_MS
        : false,
  });
