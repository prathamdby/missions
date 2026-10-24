"use client";

import type { Autonomy, ExecutionMode } from "@missions/protocol/common";
import type { AgentModelSettings } from "@missions/protocol/missions";
import type { Settings } from "@missions/protocol/settings";
import { useState } from "react";

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

import {
  chooseModels,
  defaultWorkspace,
  draftDefaults,
  nextDirtyAcknowledgement,
  reviewMissionDraft,
  resolveProject,
  resolveDefaultBranch,
} from "./mission-draft";
import type {
  DraftDefaults,
  Evidence,
  ModelChoices,
  WorkspaceChoice,
} from "./mission-draft";

/** A choice that only applies while the same project stays selected. */
interface PerProject<T> {
  projectId: string;
  value: T;
}

const pick = <T>(choice: PerProject<T> | null, projectId: string | null) =>
  choice !== null && choice.projectId === projectId ? choice.value : null;

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

/**
 * Settings-derived defaults, frozen once confirmed so a later settings event
 * cannot silently change what a draft will start with.
 */
const useDraftDefaults = (settings: Evidence<Settings>) => {
  const [frozen, setFrozen] = useState<DraftDefaults | null>(null);
  const next = frozen ?? draftDefaults(settings);
  if (next !== frozen) {
    setFrozen(next);
  }
  return next;
};

const useModelChoices = (defaults: DraftDefaults | null) => {
  const [choice, setChoice] = useState<Partial<ModelChoices>>({});
  const change = (role: keyof ModelChoices, value: AgentModelSettings) =>
    setChoice((current) => ({ ...current, [role]: value }));
  return [chooseModels(defaults, choice), change] as const;
};

const evidence = <T>(query: {
  data: T | undefined;
  isSuccess: boolean;
  isFetching: boolean;
  dataUpdatedAt: number;
}): Evidence<T> => ({
  confirmed: query.isSuccess && !query.isFetching,
  data: query.data,
  version: query.dataUpdatedAt,
});

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
  // Freeze the initial default once read queries settle; live mission updates
  // must not silently retarget a goal already being drafted.
  if (
    chosenProject === null &&
    project &&
    projects.isSuccess &&
    !missions.isPending
  ) {
    setChosenProject(project.id);
  }
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
  const [executionMode, setExecutionMode] = useState<ExecutionMode>("work");
  const [goal, setGoal] = useState("");
  const defaults = useDraftDefaults(evidence(settings));
  const [models, handleModelChange] = useModelChoices(defaults);

  const branch =
    pick(branchChoice, projectId) ??
    resolveDefaultBranch(project, branches.data);
  const workspace: WorkspaceChoice =
    pick(workspaceChoice, projectId) ?? defaultWorkspace(isGit, defaults);
  const otherWorktrees = (worktrees.data ?? []).filter(
    (entry) => !entry.isMain
  );

  const autonomy = autonomyChoice ?? settings.data?.defaultAutonomy ?? "medium";
  const newBranch = pick(newBranchChoice, projectId);
  const review = reviewMissionDraft({
    acknowledged,
    autonomy,
    branch,
    branches: evidence(branches),
    checkout: evidence(checkout),
    executionMode,
    goal,
    models,
    newBranch,
    project,
    projectsConfirmed: projects.isSuccess,
    settings: evidence(settings),
    workspace,
    worktrees: evidence(worktrees),
  });
  // Forget consent when evidence or workspace changes, including clean -> dirty.
  const retainedAcknowledgement = nextDirtyAcknowledgement(
    acknowledged,
    review
  );
  if (retainedAcknowledgement !== acknowledged) {
    setAcknowledged(retainedAcknowledgement);
  }

  return {
    autonomy,
    branch,
    checkout,
    defaultBranch: resolveDefaultBranch(project, branches.data),
    ...review,
    executionMode,
    goal,
    handleAcknowledgeDirty: () => setAcknowledged(review.dirtyKey),
    handleAutonomyChange: setAutonomyChoice,
    handleBranchChange: (value: string) =>
      projectId && setBranchChoice({ projectId, value }),
    handleExecutionModeChange: setExecutionMode,
    handleModelChange,
    handleNewBranch: (value: string | null) =>
      setNewBranchChoice(projectId && value ? { projectId, value } : null),
    handleProjectChange: (value: string) => {
      setAcknowledged(null);
      setChosenProject(value);
    },
    handleWorkspaceChange: (value: WorkspaceChoice) => {
      setAcknowledged(null);
      if (projectId) {
        setWorkspaceChoice({ projectId, value });
      }
    },
    isGit,
    missions: missions.data ?? [],
    models,
    newBranch,
    otherWorktrees,
    project,
    projects,
    setGoal: (value: string) => {
      if (chosenProject === null && project) {
        setChosenProject(project.id);
      }
      setGoal(value);
    },
    settings,
    workspace,
  };
};

export type NewMissionForm = ReturnType<typeof useNewMissionForm>;
