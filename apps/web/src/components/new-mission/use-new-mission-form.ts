"use client";

import type { CreateMissionRequest } from "@missions/protocol/commands";
import type { Autonomy } from "@missions/protocol/common";
import type { MissionSummary } from "@missions/protocol/missions";
import type { Branch, Project } from "@missions/protocol/projects";
import type { Settings } from "@missions/protocol/settings";
import type {
  CheckoutStatus,
  WorkspaceRequest,
  WorktreeInfo,
} from "@missions/protocol/workspaces";
import { useState } from "react";

import type { ModelChoice } from "@/components/new-mission/model-picker";
import type { WorkspaceChoice } from "@/components/new-mission/workspace-picker";
import { useAddProject } from "@/components/projects/add-project-context";
import { useShell } from "@/components/shell/shell-context";
import {
  useBranches,
  useCheckout,
  useMissions,
  useProjects,
  useSettings,
  useWorktrees,
} from "@/lib/api/queries";

/** A choice that only applies while the same project stays selected. */
interface PerProject<T> {
  projectId: string;
  value: T;
}

const pick = <T>(choice: PerProject<T> | null, projectId: string | null) =>
  choice !== null && choice.projectId === projectId ? choice.value : null;

export type MissionDraft = Omit<CreateMissionRequest, "operationId">;

const resolveProject = (
  list: readonly Project[],
  missions: readonly MissionSummary[],
  chosen: string | null
) => {
  const recentProjectId = missions
    .toSorted((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .find((mission) =>
      list.some((entry) => entry.id === mission.projectId)
    )?.projectId;
  return (
    list.find((entry) => entry.id === chosen) ??
    list.find((entry) => entry.id === recentProjectId) ??
    list[0] ??
    null
  );
};

const resolveDefaultBranch = (
  project: Project | null,
  branches: readonly Branch[] | undefined
) =>
  project?.defaultBranch ??
  branches?.find((entry) => entry.current)?.name ??
  branches?.[0]?.name ??
  null;

/** Uncommitted files in the chosen workspace; `null` when it is clean or unknown. */
const resolveDirty = (
  workspace: WorkspaceChoice,
  checkout: CheckoutStatus | undefined,
  worktrees: readonly WorktreeInfo[]
): { count: number; path: string } | null => {
  if (workspace.mode === "current_checkout" && checkout?.dirty) {
    return { count: checkout.dirtyFiles.length, path: checkout.path };
  }
  if (workspace.mode === "existing_worktree") {
    const target = worktrees.find((entry) => entry.path === workspace.path);
    return target?.dirty ? { count: 0, path: target.path } : null;
  }
  return null;
};

const toWorkspaceRequest = (
  workspace: WorkspaceChoice,
  branch: string | null,
  newBranch: string | null,
  dirty: boolean
): WorkspaceRequest | null => {
  if (workspace.mode === "new_worktree") {
    if (!branch) {
      return null;
    }
    return newBranch
      ? { baseBranch: branch, branchName: newBranch, mode: "new_worktree" }
      : { baseBranch: branch, mode: "new_worktree" };
  }
  if (workspace.mode === "current_checkout") {
    return { acknowledgeDirty: dirty, mode: "current_checkout" };
  }
  return {
    acknowledgeDirty: dirty,
    mode: "existing_worktree",
    path: workspace.path,
  };
};

const buildDraft = ({
  autonomy,
  goal,
  models,
  needsAcknowledge,
  project,
  workspace,
}: {
  autonomy: Autonomy;
  goal: string;
  models: ModelChoice | null;
  needsAcknowledge: boolean;
  project: Project | null;
  workspace: WorkspaceRequest | null;
}): MissionDraft | null => {
  const trimmed = goal.trim();
  if (!(project && workspace && trimmed) || needsAcknowledge) {
    return null;
  }
  return {
    autonomy,
    goal: trimmed,
    projectId: project.id,
    workspace,
    ...models,
  };
};

const resolveDefaults = (
  settings: Settings | undefined,
  autonomy: Autonomy | null,
  models: ModelChoice | null
) => ({
  autonomy: autonomy ?? settings?.defaultAutonomy ?? "medium",
  models:
    models ??
    (settings
      ? { orchestrator: settings.orchestrator, worker: settings.worker }
      : null),
});

/** The user's project choice; a newly added project or a search pick replaces it. */
const useChosenProject = () => {
  const { lastAdded } = useAddProject();
  const { preferredProject } = useShell();
  const [chosenProject, setChosenProject] = useState<string | null>(
    preferredProject?.id ?? null
  );
  const [seenAdded, setSeenAdded] = useState(lastAdded);
  if (lastAdded !== seenAdded) {
    setSeenAdded(lastAdded);
    if (lastAdded) {
      setChosenProject(lastAdded.id);
    }
  }
  const [seenPreferred, setSeenPreferred] = useState(preferredProject);
  if (preferredProject !== seenPreferred) {
    setSeenPreferred(preferredProject);
    if (preferredProject) {
      setChosenProject(preferredProject.id);
    }
  }
  return [chosenProject, setChosenProject] as const;
};

const changedFiles = (
  workspace: WorkspaceChoice,
  dirty: boolean,
  checkout: CheckoutStatus | undefined
) =>
  dirty && workspace.mode === "current_checkout"
    ? (checkout?.dirtyFiles ?? [])
    : [];

export const useNewMissionForm = () => {
  const projects = useProjects();
  const missions = useMissions();
  const settings = useSettings();
  const [chosenProject, setChosenProject] = useChosenProject();

  const project = resolveProject(
    projects.data ?? [],
    missions.data ?? [],
    chosenProject
  );
  const projectId = project?.id ?? null;
  const isGit = project?.kind === "git";

  const branches = useBranches(projectId, isGit);
  const worktrees = useWorktrees(projectId, isGit);
  const checkout = useCheckout(projectId, isGit);

  const [branchChoice, setBranchChoice] = useState<PerProject<string> | null>(
    null
  );
  const [newBranchChoice, setNewBranchChoice] =
    useState<PerProject<string> | null>(null);
  const [workspaceChoice, setWorkspaceChoice] =
    useState<PerProject<WorkspaceChoice> | null>(null);
  const [acknowledged, setAcknowledged] = useState<string | null>(null);
  const [autonomyChoice, setAutonomyChoice] = useState<Autonomy | null>(null);
  const [modelChoice, setModelChoice] = useState<ModelChoice | null>(null);
  const [goal, setGoal] = useState("");

  const branch =
    pick(branchChoice, projectId) ??
    resolveDefaultBranch(project, branches.data);
  const workspace: WorkspaceChoice =
    pick(workspaceChoice, projectId) ??
    (isGit ? { mode: "new_worktree" } : { mode: "current_checkout" });
  const otherWorktrees = (worktrees.data ?? []).filter(
    (entry) => !entry.isMain
  );

  const dirtyState = resolveDirty(workspace, checkout.data, otherWorktrees);
  const dirty = dirtyState !== null;
  const dirtyKey = `${projectId}:${workspace.mode}:${dirtyState?.path ?? ""}`;
  const needsAcknowledge = dirty && acknowledged !== dirtyKey;

  const { autonomy, models } = resolveDefaults(
    settings.data,
    autonomyChoice,
    modelChoice
  );

  const newBranch = pick(newBranchChoice, projectId);
  const workspaceRequest = toWorkspaceRequest(
    workspace,
    branch,
    newBranch,
    dirty
  );

  const draft = buildDraft({
    autonomy,
    goal,
    models,
    needsAcknowledge,
    project,
    workspace: workspaceRequest,
  });

  return {
    autonomy,
    branch,
    checkout,
    defaultBranch: resolveDefaultBranch(project, branches.data),
    dirtyCount: dirtyState?.count ?? null,
    dirtyFiles: changedFiles(workspace, dirty, checkout.data),
    draft,
    goal,
    handleAcknowledgeDirty: () => setAcknowledged(dirtyKey),
    handleAutonomyChange: setAutonomyChoice,
    handleBranchChange: (value: string) =>
      projectId && setBranchChoice({ projectId, value }),
    handleModelsChange: setModelChoice,
    handleNewBranch: (value: string | null) =>
      setNewBranchChoice(projectId && value ? { projectId, value } : null),
    handleProjectChange: setChosenProject,
    handleWorkspaceChange: (value: WorkspaceChoice) =>
      projectId && setWorkspaceChoice({ projectId, value }),
    isGit,
    missions: missions.data ?? [],
    models,
    needsAcknowledge,
    newBranch,
    otherWorktrees,
    project,
    projects,
    setGoal,
    settings,
    workspace,
  };
};

export type NewMissionForm = ReturnType<typeof useNewMissionForm>;
