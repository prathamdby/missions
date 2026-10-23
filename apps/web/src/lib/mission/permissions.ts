import type {
  PermissionDecision,
  PermissionRequest,
} from "@missions/protocol/missions";

/** Publish consent is always one-shot, even if an older payload says otherwise. */
export const permissionDecisions = (
  request: PermissionRequest
): readonly PermissionDecision[] => {
  if (request.status !== "pending") {
    return [];
  }
  return request.allowAlways && request.kind !== "publish"
    ? ["approve_once", "always_allow", "deny"]
    : ["approve_once", "deny"];
};
