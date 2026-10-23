"use client";

import type {
  PermissionDecision,
  PermissionRequest,
} from "@missions/protocol/missions";

import { useMissionCommand } from "@/components/mission/use-mission-command";
import { permissionDecisions } from "@/lib/mission/permissions";

/** Transcript and Digest bind the same epoch and share mission admission. */
export const usePermissionDecision = (request: PermissionRequest | null) => {
  const command = useMissionCommand(
    "permission",
    "Could not send your decision"
  );
  return {
    isPending: command.isPending,
    mutate: (decision: PermissionDecision) => {
      if (!request || !permissionDecisions(request).includes(decision)) {
        return;
      }
      command.mutate({
        decision,
        epoch: request.epoch,
        requestId: request.id,
      });
    },
    variables: command.variables?.decision,
  };
};
