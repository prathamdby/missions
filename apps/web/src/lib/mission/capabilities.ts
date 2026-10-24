import type { MissionStatus } from "@missions/protocol/missions";

const ACTIVE: ReadonlySet<MissionStatus> = new Set([
  "setting_up",
  "exploring",
  "running",
  "pausing",
]);
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
/** Stopped missions the daemon will forget; files stay on disk. */
const DELETABLE: ReadonlySet<MissionStatus> = new Set([
  "paused",
  "interrupted",
  "completed",
  "failed",
  "archived",
]);
const PUBLISHABLE: ReadonlySet<MissionStatus> = new Set([
  "completed",
  "paused",
  "interrupted",
  "failed",
]);

/** The daemon's stopped/active policy, shared by every mission surface. */
export const missionCapabilities = (status: MissionStatus) => ({
  active: ACTIVE.has(status),
  archive: PUBLISHABLE.has(status),
  delete: DELETABLE.has(status),
  message: PAUSABLE.has(status),
  pause: PAUSABLE.has(status),
  publish: PUBLISHABLE.has(status),
  resume: RESUMABLE.has(status),
  update: status !== "archived",
});
