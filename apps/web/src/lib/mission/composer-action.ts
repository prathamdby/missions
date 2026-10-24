import type { AgentStatus, MissionStatus } from "@missions/protocol/missions";

import { missionCapabilities } from "./capabilities";
import type { ControlAction } from "./commands";

export type PendingControl = ControlAction | null;

type ProgressLabel =
  | "Archiving…"
  | "Deleting…"
  | "Pausing…"
  | "Resuming…"
  | "Retrying…";

/** What the composer's main button does right now. */
export type ComposerAction =
  | {
      kind: "progress";
      label: ProgressLabel;
    }
  | { kind: "resume"; label: "Resume" | "Retry" }
  | { kind: "send"; enabled: boolean }
  | { kind: "pause" };

interface ComposerActionInput {
  agents: readonly { status: AgentStatus }[];
  draft: string;
  pending: PendingControl;
  status: MissionStatus;
}

const WORKING_AGENT: ReadonlySet<AgentStatus> = new Set([
  "starting",
  "working",
]);

/** Paused and interrupted missions pick up where they stopped; the rest retry. */
const CONTINUES: ReadonlySet<MissionStatus> = new Set([
  "paused",
  "interrupted",
]);

/**
 * A running mission can have every agent idle, so Pause needs actual work:
 * an agent starting or working, or the daemon still setting up the workspace.
 */
export const hasPausableWork = ({
  agents,
  status,
}: Pick<ComposerActionInput, "agents" | "status">) =>
  missionCapabilities(status).pause &&
  (status === "setting_up" ||
    agents.some((agent) => WORKING_AGENT.has(agent.status)));

const progressLabel = (
  pending: ControlAction,
  status: MissionStatus
): ProgressLabel => {
  if (pending === "archive") {
    return "Archiving…";
  }
  if (pending === "delete") {
    return "Deleting…";
  }
  if (pending === "pause") {
    return "Pausing…";
  }
  return CONTINUES.has(status) ? "Resuming…" : "Retrying…";
};

export const composerAction = (input: ComposerActionInput): ComposerAction => {
  const { draft, pending, status } = input;
  const capabilities = missionCapabilities(status);
  if (pending !== null) {
    return { kind: "progress", label: progressLabel(pending, status) };
  }
  if (status === "pausing") {
    return { kind: "progress", label: "Pausing…" };
  }
  if (capabilities.resume) {
    return {
      kind: "resume",
      label: CONTINUES.has(status) ? "Resume" : "Retry",
    };
  }
  const hasDraft = draft.trim() !== "";
  if (capabilities.message && hasDraft) {
    return { enabled: true, kind: "send" };
  }
  if (!hasDraft && hasPausableWork(input)) {
    return { kind: "pause" };
  }
  return { enabled: false, kind: "send" };
};
