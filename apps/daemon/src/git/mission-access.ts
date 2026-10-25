import type { EventBody } from "@missions/protocol/events";
import type { Mission } from "@missions/protocol/missions";

/** Publishing uses the existing facade and its existing workspace coordination. */
export interface PublishMissionAccess {
  get: (id: string) => Mission;
  patch: (id: string, change: (mission: Mission) => Mission) => Mission;
  notify: (
    missionId: string,
    code: Extract<EventBody, { type: "notice" }>["data"]["notice"]["code"],
    level: "info" | "warning" | "error",
    message: string
  ) => void;
  withWorkspaceMutation: <T>(
    missionId: string,
    effect: () => Promise<T>
  ) => Promise<T>;
  withWorkspaceRecovery: <T>(
    missionId: string,
    operationId: string,
    effect: () => Promise<T>
  ) => Promise<T>;
}
