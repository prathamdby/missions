import type {
  Assignment,
  Handoff,
  Mission,
  MissionStatus,
  PlanRevision,
} from "@missions/protocol/missions";

/** Request IDs for messages the daemon sends on the user's behalf; never mirrored in the queue tray. */
export const SYSTEM_PREFIX = "sys:";
export const isSystemRequest = (id: string | null) =>
  id?.startsWith(SYSTEM_PREFIX) ?? false;

export const FENCED: ReadonlySet<MissionStatus> = new Set([
  "pausing",
  "paused",
  "stop_failed",
  "interrupted",
  "failed",
  "archived",
]);
export const ACTIVE: ReadonlySet<MissionStatus> = new Set([
  "setting_up",
  "exploring",
  "awaiting_approval",
  "running",
  "pausing",
]);
export const RESUMABLE: ReadonlySet<MissionStatus> = new Set([
  "paused",
  "interrupted",
  "stop_failed",
]);

export const ARCHIVABLE: ReadonlySet<MissionStatus> = new Set([
  "completed",
  "paused",
  "interrupted",
  "failed",
]);

export const MAX_PENDING_ASSIGNMENTS = 20;
export const SNAPSHOT_TRANSCRIPT = 200;

export const titleFromGoal = (goal: string) => {
  const line = goal.trim().split("\n")[0] ?? "";
  return line.length > 80
    ? `${line.slice(0, 77)}…`
    : line || "Untitled mission";
};

/** The phase a resumed mission returns to, derived from its plan history. */
export const resumePhase = (
  plans: readonly PlanRevision[],
  mission: Mission
): MissionStatus => {
  if (mission.summary !== null) {
    return "completed";
  }
  if (plans.some((plan) => plan.status === "approved")) {
    return "running";
  }
  if (plans.some((plan) => plan.status === "proposed")) {
    return "awaiting_approval";
  }
  return "exploring";
};

export const planApprovedMessage = (plan: PlanRevision) =>
  `[Missions] The user approved plan revision ${plan.revision} ("${plan.title}"). You may now change files. Track progress with missions.update_todos and dispatch Workers with missions.dispatch_worker. When the work is verified, you must call missions.complete_mission; the mission is not finished until you do.`;

export const planRejectedMessage = (
  plan: PlanRevision,
  feedback: string | null
) =>
  `[Missions] The user requested changes to plan revision ${plan.revision}.${feedback ? `\nFeedback:\n${feedback}` : ""}\nRevise the plan and call missions.propose_plan again. Do not change files yet.`;

export const assignmentMessage = (assignment: Assignment) =>
  `[Missions] Assignment ${assignment.id}: ${assignment.title}\n\n${assignment.instructions}\n\n${
    assignment.needsWrite
      ? "You may edit files in the shared workspace."
      : "This is read-only analysis: do not modify files."
  } When finished, call missions.submit_handoff exactly once.`;

export const handoffMessage = (
  workerTitle: string,
  assignment: Assignment,
  handoff: Handoff
) => {
  const lines = [
    `[Missions] ${workerTitle} finished assignment ${assignment.id} ("${assignment.title}").`,
    `Summary: ${handoff.summary}`,
  ];
  if (handoff.filesChanged.length > 0) {
    lines.push(`Files changed: ${handoff.filesChanged.join(", ")}`);
  }
  for (const check of handoff.checks) {
    lines.push(`Check: ${check.command} → ${check.outcome}`);
  }
  if (handoff.followUps.length > 0) {
    lines.push(`Follow-ups: ${handoff.followUps.join("; ")}`);
  }
  lines.push("Review the shared changes before continuing.");
  return lines.join("\n");
};

export const resumedMessage = (interrupted: readonly Assignment[]) =>
  `[Missions] The mission was stopped and the user resumed it. ${
    interrupted.length > 0
      ? `These assignments were interrupted and their Workers stopped: ${interrupted.map((a) => `${a.id} ("${a.title}")`).join(", ")}. Re-dispatch any that are still needed.`
      : "No assignments were interrupted."
  } Re-check the workspace before continuing.`;

export const workerMessage = (text: string) =>
  `[Missions] Message from the Orchestrator:\n${text}`;
