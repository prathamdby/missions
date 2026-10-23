"use client";

import { createContext, use } from "react";

import type { MissionLiveState } from "@/lib/live/mission-state";
import type { LocalEntity } from "@/lib/live/mission-store";
import type { MissionCommands } from "@/lib/mission/commands";

export type PanelTab = "changes" | "digest" | "files" | "overview";

export interface MissionContextValue {
  agentLabels: Record<string, string>;
  commands: MissionCommands;
  applyLocal: (entity: LocalEntity) => void;
  live: MissionLiveState;
  loadOlder: (limit?: number) => Promise<boolean>;
  missionId: string;
  refresh: () => Promise<boolean>;
  sessionError: unknown;
  selectedAgentId: string | null;
  showAgent: (agentId: string) => void;
  /** Opens the details panel on a tab (docked or as a sheet). */
  showPanel: (tab: PanelTab) => void;
}

const MissionContext = createContext<MissionContextValue | null>(null);

export const MissionProvider = MissionContext;

export const useMission = () => {
  const value = use(MissionContext);
  if (!value) {
    throw new Error("useMission must be used inside a MissionProvider");
  }
  return value;
};
