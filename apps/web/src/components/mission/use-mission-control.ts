"use client";

import { useSyncExternalStore } from "react";

import { useMission } from "@/components/mission/mission-context";
import { useMissionCommand } from "@/components/mission/use-mission-command";

/** Every header/banner subscribes to the same synchronous mission admission. */
export const useMissionControl = () => {
  const { commands, live } = useMission();
  const pending = useSyncExternalStore(
    commands.subscribe,
    commands.pendingControl,
    commands.pendingControl
  );
  const pause = useMissionCommand("pause", "Could not pause");
  const resume = useMissionCommand("resume", "Could not resume");
  const body = () => ({ expectedRevision: live.mission.revision });
  return {
    pause: () => pause.mutate(body()),
    pausing: pending === "pause",
    pending: pending !== null,
    resume: () => resume.mutate(body()),
    resuming: pending === "resume",
  };
};
