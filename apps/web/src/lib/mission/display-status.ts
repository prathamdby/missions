import type { BadgeTone } from "@/components/ui/badge";
import { MISSION_STATUS, isMissionActive } from "@/lib/format";
import type { MissionLiveState } from "@/lib/live/mission-state";

export interface DisplayStatus {
  label: string;
  tone: BadgeTone;
}

type StatusInput = Pick<
  MissionLiveState,
  "mission" | "permissions" | "questions"
>;

/** True while a permission or question waits on the user. */
export const needsUser = (live: Omit<StatusInput, "mission">) =>
  Object.values(live.permissions).some(
    (request) => request.status === "pending"
  ) ||
  Object.values(live.questions).some(
    (question) => question.status === "pending"
  );

/**
 * The header pill. Pending input outranks the lifecycle status, and a
 * published mission reads as its pull request ("In review", "Merged").
 */
export const displayStatus = (live: StatusInput): DisplayStatus => {
  const { mission } = live;
  if (mission.status === "archived") {
    return MISSION_STATUS.archived;
  }
  if (needsUser(live) || mission.status === "awaiting_approval") {
    return { label: "Needs you", tone: "warning" };
  }
  if (
    mission.lastError?.code === "environment" &&
    (isMissionActive(mission.status) || mission.status === "interrupted")
  ) {
    return { label: "Blocked", tone: "danger" };
  }
  if (mission.status === "exploring") {
    return { label: "Planning", tone: "accent" };
  }
  const { pr } = mission.publish;
  if (pr?.state === "merged") {
    return { label: "Merged", tone: "success" };
  }
  if (pr?.state === "open") {
    return { label: "In review", tone: "info" };
  }
  return MISSION_STATUS[mission.status];
};
