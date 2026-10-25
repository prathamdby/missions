"use client";

import type { QueryClient } from "@tanstack/react-query";
import { useEffect } from "react";

import type { MissionCommandSink } from "./command-registry";
import { attachMissionSink, missionCommandsFor } from "./command-registry";

/** Bind the existing command registry to this mounted view's live store. */
export const useMissionCommands = (
  client: QueryClient,
  missionId: string,
  applyLocal: MissionCommandSink["apply"],
  refresh: MissionCommandSink["refresh"]
) => {
  const commands = missionCommandsFor(client, missionId);
  useEffect(
    () => attachMissionSink(client, missionId, { apply: applyLocal, refresh }),
    [client, missionId, applyLocal, refresh]
  );
  return commands;
};
