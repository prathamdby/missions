import type { Agent, MissionStatus } from "@missions/protocol/missions";

import type { BadgeTone } from "@/components/ui/badge";

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;
const PAD = 2;

/** Compact age: "now", "4m", "3h", "2d", "1w". */
export const shortAge = (iso: string, now: number) => {
  const elapsed = Math.max(0, now - Date.parse(iso));
  if (elapsed < MINUTE) {
    return "now";
  }
  if (elapsed < HOUR) {
    return `${Math.floor(elapsed / MINUTE)}m`;
  }
  if (elapsed < DAY) {
    return `${Math.floor(elapsed / HOUR)}h`;
  }
  if (elapsed < WEEK) {
    return `${Math.floor(elapsed / DAY)}d`;
  }
  return `${Math.floor(elapsed / WEEK)}w`;
};

/** Timer text: "5m 08s", "1h 02m". */
export const formatDuration = (ms: number) => {
  const total = Math.max(0, Math.floor(ms / SECOND));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  if (hours > 0) {
    return `${hours}h ${String(minutes).padStart(PAD, "0")}m`;
  }
  return `${minutes}m ${String(seconds).padStart(PAD, "0")}s`;
};

/** "12s ago", "4m ago", "2h ago". */
export const formatAgo = (ms: number) => {
  const elapsed = Math.max(0, ms);
  if (elapsed < MINUTE) {
    return `${Math.floor(elapsed / SECOND)}s ago`;
  }
  if (elapsed < HOUR) {
    return `${Math.floor(elapsed / MINUTE)}m ago`;
  }
  return `${Math.floor(elapsed / HOUR)}h ago`;
};

export const secondsUntil = (at: number | null, now: number) =>
  at === null ? 0 : Math.max(0, Math.ceil((at - now) / SECOND));

interface StatusMeta {
  label: string;
  tone: BadgeTone;
}

export const MISSION_STATUS: Record<MissionStatus, StatusMeta> = {
  archived: { label: "Archived", tone: "quiet" },
  awaiting_approval: { label: "Needs you", tone: "warning" },
  completed: { label: "Done", tone: "success" },
  exploring: { label: "Exploring", tone: "accent" },
  failed: { label: "Failed", tone: "danger" },
  interrupted: { label: "Interrupted", tone: "warning" },
  paused: { label: "Paused", tone: "muted" },
  pausing: { label: "Pausing", tone: "muted" },
  running: { label: "Running", tone: "accent" },
  setting_up: { label: "Setting up", tone: "accent" },
  stop_failed: { label: "Stop failed", tone: "danger" },
};

const ACTIVE: ReadonlySet<MissionStatus> = new Set([
  "setting_up",
  "exploring",
  "running",
  "pausing",
]);

export const isMissionActive = (status: MissionStatus) => ACTIVE.has(status);

const PAUSABLE: ReadonlySet<MissionStatus> = new Set([
  "setting_up",
  "exploring",
  "awaiting_approval",
  "running",
]);

const RESUMABLE: ReadonlySet<MissionStatus> = new Set([
  "failed",
  "interrupted",
  "paused",
  "stop_failed",
]);

export const canPause = (status: MissionStatus) => PAUSABLE.has(status);
export const canResume = (status: MissionStatus) => RESUMABLE.has(status);

/** "Orchestrator", "Worker 1", "Worker 2" in creation order. */
export const agentLabels = (agents: readonly Agent[]) => {
  const labels: Record<string, string> = {};
  let worker = 0;
  for (const agent of agents.toSorted((a, b) =>
    a.createdAt.localeCompare(b.createdAt)
  )) {
    if (agent.role === "orchestrator") {
      labels[agent.id] = "Orchestrator";
    } else {
      worker += 1;
      labels[agent.id] = `Worker ${worker}`;
    }
  }
  return labels;
};

export const projectLabel = (path: string) => {
  const parts = path.split(/[/\\]/u).filter(Boolean);
  return parts.at(-1) ?? path;
};

/** Collapses the home directory to "~" for display. */
export const tildePath = (path: string, home: string | null) =>
  home && path.startsWith(home) ? `~${path.slice(home.length)}` : path;
