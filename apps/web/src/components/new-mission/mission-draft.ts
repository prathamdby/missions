import type { CreateMissionRequest } from "@missions/protocol/commands";
import type { Autonomy, ExecutionMode } from "@missions/protocol/common";
import type {
  AgentModelSettings,
  MissionSummary,
} from "@missions/protocol/missions";
import type { Branch, Project } from "@missions/protocol/projects";
import type {
  DefaultWorkspaceMode,
  Settings,
} from "@missions/protocol/settings";
import type {
  CheckoutStatus,
  WorkspaceRequest,
  WorktreeInfo,
} from "@missions/protocol/workspaces";

export type MissionDraft = Omit<CreateMissionRequest, "operationId">;
export type WorkspaceChoice =
  | { mode: "current_checkout" }
  | { mode: "existing_worktree"; path: string }
  | { mode: "new_worktree" };

/** The models a new mission starts with. */
export interface ModelChoices {
  orchestrator: AgentModelSettings;
  worker: AgentModelSettings;
}

export interface Evidence<T> {
  data: T | undefined;
  confirmed: boolean;
  version: number;
}

/** Settings a draft starts from, read once from confirmed Settings. */
export interface DraftDefaults {
  models: ModelChoices;
  workspaceMode: DefaultWorkspaceMode;
}

export const draftDefaults = ({
  confirmed,
  data,
}: Evidence<Settings>): DraftDefaults | null =>
  confirmed && data
    ? {
        models: { orchestrator: data.orchestrator, worker: data.worker },
        workspaceMode: data.defaultWorkspaceMode,
      }
    : null;

/** Explicit model picks win over the frozen defaults, per role. */
export const chooseModels = (
  defaults: DraftDefaults | null,
  choice: Partial<ModelChoices>
): ModelChoices | null =>
  defaults
    ? {
        orchestrator: choice.orchestrator ?? defaults.models.orchestrator,
        worker: choice.worker ?? defaults.models.worker,
      }
    : null;

/** Non-Git folders can only run in place; Git projects follow the saved default. */
export const defaultWorkspace = (
  isGit: boolean,
  defaults: Pick<DraftDefaults, "workspaceMode"> | null
): WorkspaceChoice =>
  isGit && defaults?.workspaceMode !== "current_checkout"
    ? { mode: "new_worktree" }
    : { mode: "current_checkout" };

export const resolveProject = (
  list: readonly Project[],
  missions: readonly MissionSummary[],
  chosen: string | null
) => {
  if (chosen !== null) {
    return list.find((entry) => entry.id === chosen) ?? null;
  }
  const recent = missions
    .toSorted((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .find((mission) => list.some((entry) => entry.id === mission.projectId));
  return (
    list.find((entry) => entry.id === recent?.projectId) ?? list[0] ?? null
  );
};

export const resolveDefaultBranch = (
  project: Project | null,
  branches: readonly Branch[] | undefined
) =>
  project?.defaultBranch ??
  branches?.find((entry) => entry.current)?.name ??
  branches?.[0]?.name ??
  null;

interface DraftInput {
  acknowledged: string | null;
  autonomy: Autonomy;
  branch: string | null;
  branches: Evidence<readonly Branch[]>;
  checkout: Evidence<CheckoutStatus>;
  /** Work (the default) is omitted from the request. */
  executionMode?: ExecutionMode;
  goal: string;
  /** Explicit or frozen choices; Settings defaults when omitted. */
  models?: ModelChoices | null;
  newBranch: string | null;
  project: Project | null;
  projectsConfirmed: boolean;
  settings: Evidence<Settings>;
  workspace: WorkspaceChoice;
  worktrees: Evidence<readonly WorktreeInfo[]>;
}

interface WorkspaceReview {
  count: number | null;
  dirty: boolean;
  files: readonly string[];
  fingerprint: unknown;
  known: boolean;
  path: string;
}

const checkoutReview = ({ checkout, project }: DraftInput): WorkspaceReview => {
  const data = checkout.confirmed ? checkout.data : undefined;
  const dirty = data?.dirty ?? false;
  const files = dirty ? (data?.dirtyFiles ?? []) : [];
  return {
    count: dirty ? files.length : null,
    dirty,
    files,
    fingerprint: [...files].toSorted(),
    known: data !== undefined || project?.kind === "directory",
    path: data?.path ?? project?.path ?? "",
  };
};

const workspaceReview = (input: DraftInput): WorkspaceReview => {
  const { workspace, worktrees } = input;
  if (workspace.mode !== "existing_worktree") {
    return checkoutReview(input);
  }
  const { path } = workspace;
  const target = worktrees.confirmed
    ? worktrees.data?.find((entry) => entry.path === path && !entry.isMain)
    : undefined;
  const dirty = target?.dirty ?? false;
  return {
    count: dirty ? 0 : null,
    dirty,
    files: [],
    // The compact worktree protocol has no dirty filenames. Every fresh
    // fetch requires review rather than assuming unknown changes are unchanged.
    fingerprint: [target?.head, worktrees.version],
    known: target !== undefined,
    path,
  };
};

const workspaceRequest = (
  input: DraftInput,
  review: WorkspaceReview,
  needsAcknowledge: boolean
): WorkspaceRequest | null => {
  if (input.workspace.mode !== "new_worktree") {
    return review.known
      ? {
          ...input.workspace,
          acknowledgeDirty: review.dirty && !needsAcknowledge,
        }
      : null;
  }
  const { branch, branches, newBranch, project } = input;
  if (
    project?.kind !== "git" ||
    !branch ||
    !branches.confirmed ||
    !branches.data?.some((entry) => entry.name === branch)
  ) {
    return null;
  }
  return {
    baseBranch: branch,
    mode: "new_worktree",
    ...(newBranch ? { branchName: newBranch } : {}),
  };
};

const buildRequest = (
  input: DraftInput,
  workspace: WorkspaceRequest | null,
  needsAcknowledge: boolean
): MissionDraft | null => {
  const { project, settings } = input;
  const goal = input.goal.trim();
  if (
    !project ||
    !input.projectsConfirmed ||
    !settings.confirmed ||
    !settings.data ||
    !workspace ||
    !goal ||
    needsAcknowledge
  ) {
    return null;
  }
  const models = input.models ?? settings.data;
  return {
    autonomy: input.autonomy,
    ...(input.executionMode === "plan"
      ? { executionMode: "plan" as const }
      : {}),
    goal,
    orchestrator: models.orchestrator,
    projectId: project.id,
    worker: models.worker,
    workspace,
  };
};

/** Readiness and dirty consent derive from confirmed evidence, never error fallbacks. */
export const reviewMissionDraft = (input: DraftInput) => {
  const review = workspaceReview(input);
  const dirtyKey =
    review.dirty && input.workspace.mode !== "new_worktree"
      ? JSON.stringify([
          input.project?.id,
          input.workspace.mode,
          review.path,
          review.fingerprint,
        ])
      : null;
  const needsAcknowledge = dirtyKey !== null && input.acknowledged !== dirtyKey;
  const workspace = workspaceRequest(input, review, needsAcknowledge);
  return {
    dirtyCount: review.count,
    dirtyFiles: review.files,
    dirtyKey,
    draft: buildRequest(input, workspace, needsAcknowledge),
    needsAcknowledge,
    workspaceKnown: review.known,
  };
};

/** Unknown evidence blocks submission, but cannot prove that reviewed files changed. */
export const nextDirtyAcknowledgement = (
  previous: string | null,
  review: Pick<
    ReturnType<typeof reviewMissionDraft>,
    "dirtyKey" | "workspaceKnown"
  >
) => (!review.workspaceKnown || previous === review.dirtyKey ? previous : null);
