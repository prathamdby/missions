import type { ExecutionMode } from "@missions/protocol/common";
import type { Mission } from "@missions/protocol/missions";

const LABEL: Record<ExecutionMode, string> = { plan: "Plan", work: "Work" };

/** The mode new work runs in once any requested transition applies. */
export const effectiveMode = (
  mission: Pick<Mission, "executionMode" | "pendingExecutionMode">
): ExecutionMode => mission.pendingExecutionMode ?? mission.executionMode;

/**
 * The mode to put on a message: only a change from the effective mode is
 * sent, so ordinary replies never toggle Plan mode by accident.
 */
export const requestedMode = (
  mission: Pick<Mission, "executionMode" | "pendingExecutionMode">,
  selected: ExecutionMode
): ExecutionMode | undefined =>
  selected === effectiveMode(mission) ? undefined : selected;

/** "Plan mode · read-only", a pending switch, or null in plain Work mode. */
export const modeStatus = (
  mission: Pick<Mission, "executionMode" | "pendingExecutionMode">
): string | null => {
  const pending = mission.pendingExecutionMode;
  if (pending !== null && pending !== mission.executionMode) {
    return `Switching to ${LABEL[pending]} after current work`;
  }
  return mission.executionMode === "plan" ? "Plan mode · read-only" : null;
};
