import type {
  Agent,
  Mission,
  PlanRevision,
  QueueItem,
  TranscriptItem,
} from "@missions/protocol/missions";

/**
 * Stored documents are protocol JSON written by whichever build saved them.
 * Schema defaults alone never rewrite old rows, so every read fills fields
 * added since v1 explicitly. Fields present in the document always win.
 */
type Stored<T> = Partial<T> & Record<string, unknown>;

export const normalizeMission = (data: unknown): Mission => {
  const stored = data as Stored<Mission>;
  return {
    executionMode: "work",
    pendingExecutionMode: null,
    ...stored,
    endedAt: stored.endedAt ?? null,
  } as Mission;
};

export const normalizeAgent = (data: unknown): Agent =>
  ({
    previousSessionIds: [],
    promptVersion: null,
    sessionGeneration: 0,
    waitingReason: null,
    ...(data as Stored<Agent>),
  }) as Agent;

/** Legacy proposals stay historical: no live native approval is bound to them. */
export const normalizePlan = (data: unknown): PlanRevision =>
  ({
    actionable: false,
    agentId: null,
    epoch: null,
    guidanceVersion: null,
    sessionId: null,
    toolUseId: null,
    ...(data as Stored<PlanRevision>),
  }) as PlanRevision;

export const normalizeQueueItem = (data: unknown): QueueItem =>
  ({
    executionMode: null,
    origin: "user",
    purpose: "message",
    retryOf: null,
    sender: null,
    sequence: 0,
    ...(data as Stored<QueueItem>),
  }) as QueueItem;

/** Old system messages keep their text; sender identity is never inferred from it. */
export const normalizeTranscriptItem = (data: unknown): TranscriptItem =>
  ({
    purpose: null,
    recipient: null,
    sender: null,
    ...(data as Stored<TranscriptItem>),
  }) as TranscriptItem;
