"use client";

import type { TranscriptItem } from "@missions/protocol/missions";
import { createContext, use } from "react";

import type { MissionLiveState } from "@/lib/live/mission-state";
import type { LocalEntity } from "@/lib/live/mission-store";

export type PanelTab = "changes" | "digest" | "files" | "overview";

export interface MissionContextValue {
  agentLabels: Record<string, string>;
  applyLocal: (entity: LocalEntity) => void;
  live: MissionLiveState;
  missionId: string;
  prependTranscript: (
    items: readonly TranscriptItem[],
    hasMore: boolean
  ) => void;
  refresh: () => Promise<boolean>;
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
