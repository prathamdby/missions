import type { Mission } from "@missions/protocol/missions";

/** Read-only Plan status; plain Work mode needs no status label. */
export const modeStatus = (
  mission: Pick<Mission, "executionMode">
): string | null =>
  mission.executionMode === "plan" ? "Plan mode · read-only" : null;
