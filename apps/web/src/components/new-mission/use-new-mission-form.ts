"use client";

import type { Autonomy } from "@missions/protocol/common";
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
  nextDirtyAcknowledgement,
  reviewMissionDraft,
  resolveProject,
  resolveDefaultBranch,
} from "./mission-draft";
import type { Evidence, WorkspaceChoice } from "./mission-draft";

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

  const autonomy = autonomyChoice ?? settings.data?.defaultAutonomy ?? "medium";
  const newBranch = pick(newBranchChoice, projectId);
  const review = reviewMissionDraft({
    acknowledged,
    autonomy,
    branch,
    branches: evidence(branches),
    checkout: evidence(checkout),
    goal,
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
    goal,
    handleAcknowledgeDirty: () => setAcknowledged(review.dirtyKey),
    handleAutonomyChange: setAutonomyChoice,
    handleBranchChange: (value: string) =>
      projectId && setBranchChoice({ projectId, value }),
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
