import type { DaemonEvent, EventBody } from "@missions/protocol/events";
import { SSE_EVENT } from "@missions/protocol/http";
import type {
  Mission,
  MissionSnapshot,
  PermissionRequest,
  PlanRevision,
  Question,
  QueueItem,
  TranscriptItem,
} from "@missions/protocol/missions";

import { openEventStream } from "./event-stream";
import type { EventSourceAdapter, OpenEventStream } from "./event-stream";

export const AT = "2026-01-01T00:00:00.000Z";
export const MISSION_ID = "m-1";

export const mission = (revision = 1): Mission => ({
  createdAt: AT,
  endedAt: null,
  epoch: 0,
  executionMode: "work",
  goal: "Fix the flaky test",
  id: MISSION_ID,
  lastError: null,
  orchestrator: { modelId: "opus", reasoningEffort: "high" },
  projectId: "p-1",
  publish: {
    cleanup: "none",
    cleanupReason: null,
    commits: [],
    pr: null,
    pushedBranch: null,
    remote: null,
  },
  revision,
  status: "running",
  summary: null,
  title: `Mission revision ${revision}`,
  updatedAt: AT,
  worker: { modelId: "sonnet", reasoningEffort: "medium" },
  workspace: null,
});

export const transcriptItem = (
  seq: number,
  text = `Item ${seq}`
): TranscriptItem => ({
  agentId: "a-1",
  createdAt: AT,
  id: `t-${seq}`,
  isError: false,
  kind: "assistant",
  missionId: MISSION_ID,
  purpose: null,
  recipient: null,
  requestId: null,
  sender: null,
  seq,
  text,
  toolName: null,
  toolUseId: null,
});

export const permission = (
  status: PermissionRequest["status"]
): PermissionRequest => ({
  agentId: "a-1",
  allowAlways: true,
  createdAt: AT,
  decidedAt: status === "pending" ? null : AT,
  decision: status === "approved" ? "approve_once" : null,
  epoch: 0,
  id: "permission-1",
  kind: "tool",
  missionId: MISSION_ID,
  reason: null,
  status,
  toolUses: [],
});

export const plan = (status: PlanRevision["status"]): PlanRevision => ({
  actionable: false,
  agentId: null,
  createdAt: AT,
  decidedAt: status === "proposed" ? null : AT,
  epoch: null,
  feedback: null,
  guidanceVersion: null,
  id: "plan-1",
  markdown: "Fix it",
  missionId: MISSION_ID,
  revision: 1,
  sessionId: null,
  status,
  title: "Fix",
  toolUseId: null,
});

export const question = (status: Question["status"]): Question => ({
  agentId: "a-1",
  answers: status === "answered" ? [{ answer: "Yes", index: 1 }] : null,
  createdAt: AT,
  epoch: 0,
  id: "question-1",
  missionId: MISSION_ID,
  questions: [],
  status,
});

export const queueItem = (
  revision: number,
  state: QueueItem["state"]
): QueueItem => ({
  agentId: "a-1",
  attachments: [],
  createdAt: AT,
  error: null,
  id: "queue-1",
  missionId: MISSION_ID,
  mode: "queue",
  origin: "user",
  purpose: "message",
  replacedById: null,
  replacesId: null,
  retryOf: null,
  revision,
  sender: null,
  sequence: 0,
  state,
  text: "Fix it",
  updatedAt: AT,
});

export const snapshot = (
  overrides: Partial<MissionSnapshot> = {}
): MissionSnapshot => ({
  agents: [],
  artifacts: [],
  assignments: [],
  cursor: 10,
  mission: mission(),
  permissions: [],
  plans: [],
  questions: [],
  queue: [],
  todos: [],
  transcript: [transcriptItem(1)],
  transcriptHasMore: false,
  ...overrides,
});

export const event = (
  seq: number,
  body?: EventBody,
  missionId: string | null = MISSION_ID
): DaemonEvent => ({
  ...(body ?? { data: { paths: [] }, type: "workspace.changed" }),
  at: AT,
  missionId,
  seq,
});

export interface Deferred<T> {
  promise: Promise<T>;
  reject: (error: unknown) => void;
  resolve: (value: T) => void;
}

export const deferred = <T>(): Deferred<T> => Promise.withResolvers<T>();

/** Deliberately ignores cancellation, exercising the session's own stale-read checks. */
export const snapshotAdapter = () => {
  const reads: (Deferred<MissionSnapshot> & { signal: AbortSignal })[] = [];
  return {
    fetchSnapshot: (_missionId: string, signal: AbortSignal) => {
      const read = { ...deferred<MissionSnapshot>(), signal };
      reads.push(read);
      return read.promise;
    },
    reads,
  };
};

export class TestEventSource implements EventSourceAdapter {
  closed = false;
  private readonly listeners = new Map<
    string,
    ((message: { data?: unknown }) => void)[]
  >();

  readonly url: string;

  constructor(url: string) {
    this.url = url;
  }

  addEventListener(
    type: string,
    listener: (message: { data?: unknown }) => void
  ) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }

  close() {
    this.closed = true;
  }

  /** Also emits after close to simulate browser callbacks already queued for delivery. */
  emit(type: string, data?: unknown) {
    for (const listener of this.listeners.get(type) ?? []) {
      listener({ data });
    }
  }

  send(...events: DaemonEvent[]) {
    for (const entry of events) {
      this.emit(SSE_EVENT, JSON.stringify(entry));
    }
  }
}

/** Uses production parsing, batching, reconnects and cursor evaluation, not a stream mock. */
export const streamAdapter = () => {
  const sources: TestEventSource[] = [];
  const openStream: OpenEventStream = (options) =>
    openEventStream(options, {
      createSource: (url) => {
        const source = new TestEventSource(url);
        sources.push(source);
        return source;
      },
      random: () => 0,
    });
  return { openStream, sources };
};

export const settle = async () => {
  // Snapshot, optional transcript bridging, and begin/connect each await a read.
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
};
