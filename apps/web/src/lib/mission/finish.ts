import type { Changes } from "@missions/protocol/files";
import type { Mission, MissionStatus } from "@missions/protocol/missions";

const PUBLISHABLE: ReadonlySet<MissionStatus> = new Set([
  "completed",
  "paused",
  "interrupted",
  "failed",
]);

/** The daemon archives only missions that finished or stopped. */
export const canArchive = (status: MissionStatus) => PUBLISHABLE.has(status);

export type FinishStep =
  /** Uncommitted changes wait for review and a commit. */
  | "commit"
  /** Nothing changed and nothing was committed. */
  | "empty"
  /** Not publishable in this status, or changes are still loading. */
  | "none"
  | "pr"
  | "push"
  /** A PR exists; follow it. */
  | "review";

export interface FinishState {
  /** Files the commit would include. */
  pending: Changes["files"];
  /** Pre-existing dirty files that need explicit consent to commit. */
  preExisting: Changes["files"];
  step: FinishStep;
}

/**
 * Where the finish flow stands, from the mission's publish record and the
 * reviewed change set. Mirrors the daemon's gates: commit while files are
 * uncommitted, push once commits exist, then open the PR.
 */
export const finishState = (
  mission: Pick<Mission, "publish" | "status" | "workspace">,
  changes: Changes | undefined
): FinishState => {
  const idle = { pending: [], preExisting: [] };
  if (!PUBLISHABLE.has(mission.status) || !mission.workspace) {
    return { ...idle, step: "none" };
  }
  const { publish } = mission;
  if (publish.pr) {
    return { ...idle, step: "review" };
  }
  if (!changes) {
    return { ...idle, step: "none" };
  }
  const pending = changes.files.filter((file) => !file.committed);
  if (pending.length > 0) {
    return {
      pending,
      preExisting: pending.filter((file) => file.preExisting),
      step: "commit",
    };
  }
  if (publish.pushedBranch) {
    return { ...idle, step: "pr" };
  }
  if (publish.commits.length > 0) {
    return { ...idle, step: "push" };
  }
  return { ...idle, step: "empty" };
};

/** Commit subject: the mission title, then the summary as the body. */
export const defaultCommitMessage = (
  mission: Pick<Mission, "summary" | "title">
) =>
  mission.summary
    ? `${mission.title}\n\n${mission.summary.trim()}`
    : mission.title;

export const defaultPrBody = (mission: Pick<Mission, "goal" | "summary">) =>
  [mission.summary?.trim(), `Goal: ${mission.goal.trim()}`]
    .filter(Boolean)
    .join("\n\n");
