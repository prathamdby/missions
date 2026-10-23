"use client";

import { useMission } from "@/components/mission/mission-context";
import { reportMutationError } from "@/components/mission/report-error";
import { useSingleFlightMutation } from "@/lib/api/use-operation";
import type {
  MissionCommandInputs,
  MissionCommandKind,
  MissionCommandResults,
} from "@/lib/mission/commands";

/** Callers supply the entire immutable payload at the interaction, not later. */
export const useMissionCommand = <K extends MissionCommandKind>(
  kind: K,
  title: string,
  onSuccess?: (
    value: MissionCommandResults[K],
    input: MissionCommandInputs[K]
  ) => void,
  occurrence?: string
) => {
  const { commands, refresh } = useMission();
  return useSingleFlightMutation({
    mutationFn: (input: MissionCommandInputs[K]) =>
      commands.run(kind, input, occurrence),
    onError: (error) => reportMutationError(error, refresh, title),
    onSuccess,
  });
};
