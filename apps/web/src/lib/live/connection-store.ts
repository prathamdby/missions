import type { StreamStatus } from "./event-stream";

export type ConnectionPhase = "connecting" | "offline" | "online";

export interface ConnectionSnapshot {
  attempt: number;
  /** When the first stream started failing; null while online. */
  offlineSince: number | null;
  phase: ConnectionPhase;
  retryAt: number | null;
}

interface Entry {
  retryNow: () => void;
  status: StreamStatus;
}

const entries = new Map<string, Entry>();
const listeners = new Set<() => void>();

const INITIAL: ConnectionSnapshot = {
  attempt: 0,
  offlineSince: null,
  phase: "connecting",
  retryAt: null,
};

let snapshot: ConnectionSnapshot = INITIAL;

const phaseOf = (statuses: StreamStatus[]): ConnectionPhase => {
  const active = statuses.filter((status) => status.phase !== "closed");
  if (active.some((status) => status.phase === "retrying")) {
    return "offline";
  }
  if (active.length > 0 && active.every((status) => status.phase === "open")) {
    return "online";
  }
  return "connecting";
};

const recompute = () => {
  const statuses = [...entries.values()].map((entry) => entry.status);
  const phase = phaseOf(statuses);
  const retrying = statuses.filter((status) => status.phase === "retrying");
  const retryTimes = retrying
    .map((status) => status.retryAt)
    .filter((at): at is number => at !== null);
  const offlineSince =
    phase === "offline" ? (snapshot.offlineSince ?? Date.now()) : null;
  snapshot = {
    attempt: Math.max(0, ...retrying.map((status) => status.attempt)),
    offlineSince: phase === "connecting" ? snapshot.offlineSince : offlineSince,
    phase,
    retryAt: retryTimes.length > 0 ? Math.min(...retryTimes) : null,
  };
  for (const listener of listeners) {
    listener();
  }
};

export const reportStream = (id: string, entry: Entry) => {
  entries.set(id, entry);
  recompute();
};

export const removeStream = (id: string) => {
  if (entries.delete(id)) {
    recompute();
  }
};

export const retryAllStreams = () => {
  for (const entry of entries.values()) {
    entry.retryNow();
  }
};

export const subscribeConnection = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

export const getConnection = () => snapshot;
export const getServerConnection = () => INITIAL;
