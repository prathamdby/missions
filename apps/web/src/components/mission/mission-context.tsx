"use client";

import type { TranscriptItem } from "@missions/protocol/missions";
import { createContext, use } from "react";

import type { MissionLiveState } from "@/lib/live/mission-state";
import type { LocalEntity } from "@/lib/live/mission-store";
import type { MissionCommands } from "@/lib/mission/commands";
import type { IdleSubmission } from "@/lib/mission/idle-send";
import type { MessageDraft } from "@/lib/mission/message-draft";

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
  closedAgentIds: readonly string[];
  closeAgent: (agentId: string) => void;
  idleSubmissions: Readonly<Record<string, IdleSubmission>>;
  presentIdleSubmission: (submission: IdleSubmission) => void;
  failIdleSubmission: (id: string) => void;
  showAgent: (agentId: string) => void;
  /** Opens the details panel on a tab (docked or as a sheet). */
  showPanel: (tab: PanelTab) => void;
  /** The composer's draft, so Edit from here can restore a message unsent. */
  draft: MessageDraft;
  /** Restores a user message into the composer. Sends nothing. */
  rewindFrom: (item: TranscriptItem) => void;
  /** Opens a new mission whose goal is the conversation through this message. */
  forkFrom: (item: TranscriptItem) => void;
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
