"use client";

import { useMission } from "@/components/mission/mission-context";
import { reportMutationError } from "@/components/mission/report-error";
import { api } from "@/lib/api/endpoints";
import {
  useOperationIds,
  useSingleFlightMutation,
} from "@/lib/api/use-operation";

/** Pause and Resume, bound to the mission revision the user saw. */
export const useMissionControl = () => {
  const { applyLocal, live, missionId, refresh } = useMission();
  const ops = useOperationIds();
  const { revision } = live.mission;

  const control = useSingleFlightMutation({
    mutationFn: (action: "pause" | "resume") => {
      const body = {
        expectedRevision: revision,
        operationId: ops.idFor(`${action}:${revision}`),
      };
      return action === "pause"
        ? api.pauseMission(missionId, body)
        : api.resumeMission(missionId, body);
    },
    onError: (error, action) =>
      reportMutationError(
        error,
        refresh,
        action === "pause" ? "Could not pause" : "Could not resume"
      ),
    onSuccess: (value) => {
      ops.settle();
      applyLocal({ kind: "mission", value });
    },
  });

  return {
    pause: () => control.mutate("pause"),
    pausing: control.isPending && control.variables === "pause",
    resume: () => control.mutate("resume"),
    resuming: control.isPending && control.variables === "resume",
  };
};
