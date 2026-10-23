import type { DaemonEvent, Notice } from "@missions/protocol/events";
import type {
  Agent,
  Artifact,
  Assignment,
  Mission,
  MissionSnapshot,
  Operation,
  PermissionRequest,
  PlanRevision,
  QueueItem,
  Question,
  Todo,
  TranscriptItem,
} from "@missions/protocol/missions";

/** Todos with `agentId: null` belong to the mission as a whole. */
export const MISSION_TODOS = "mission";

export type PreviewKind = "text" | "thinking";

export interface StreamingPreview {
  agentId: string;
  /** Delta text keyed by event seq so out-of-order chunks still join in order. */
  chunks: Record<number, string>;
  kind: PreviewKind;
  messageId: string;
}

export interface LiveNotice extends Notice {
  at: string;
  seq: number;
}

/**
 * Normalized mission state. Every entity is stored by id together with the
 * seq of the event that last wrote it (`versions`), so applying the same set
 * of events in any order, any number of times, yields the same state.
 */
export interface MissionLiveState {
  agents: Record<string, Agent>;
  /** Highest seq seen; the resume cursor for the event stream. */
  applied: number;
  artifacts: Record<string, Artifact>;
  assignments: Record<string, Assignment>;
  /** Snapshot cursor. Events at or below it are already reflected. */
  base: number;
  changedPaths: readonly string[];
  /**
   * Highest seq per `${agentId}:${kind}` through which streaming is over: an
   * authoritative transcript item arrived or the agent stopped.
   */
  finalized: Record<string, number>;
  mission: Mission;
  notices: Record<number, LiveNotice>;
  operations: Record<string, Operation>;
  permissions: Record<string, PermissionRequest>;
  plans: Record<string, PlanRevision>;
  previews: Record<string, StreamingPreview>;
  questions: Record<string, Question>;
  queue: Record<string, QueueItem>;
  /** Seq through which the whole mission stopped streaming (paused, ended). */
  settled: number;
  todos: Record<string, readonly Todo[]>;
  transcript: Record<string, TranscriptItem>;
  transcriptHasMore: boolean;
  versions: Record<string, number>;
  workspaceSeq: number;
}

const byId = <T extends { id: string }>(items: readonly T[]) => {
  const out: Record<string, T> = {};
  for (const item of items) {
    out[item.id] = item;
  }
  return out;
};

const groupTodos = (todos: readonly Todo[]) => {
  const out: Record<string, Todo[]> = {};
  for (const todo of todos) {
    const key = todo.agentId ?? MISSION_TODOS;
    out[key] = [...(out[key] ?? []), todo];
  }
  return out;
};

export const fromSnapshot = (snapshot: MissionSnapshot): MissionLiveState => ({
  agents: byId(snapshot.agents),
  applied: snapshot.cursor,
  artifacts: byId(snapshot.artifacts),
  assignments: byId(snapshot.assignments),
  base: snapshot.cursor,
  changedPaths: [],
  finalized: {},
  mission: snapshot.mission,
  notices: {},
  operations: {},
  permissions: byId(snapshot.permissions),
  plans: byId(snapshot.plans),
  previews: {},
  questions: byId(snapshot.questions),
  queue: byId(snapshot.queue),
  settled: 0,
  todos: groupTodos(snapshot.todos),
  transcript: byId(snapshot.transcript),
  transcriptHasMore: snapshot.transcriptHasMore,
  versions: {},
  workspaceSeq: snapshot.cursor,
});

const versionOf = (state: MissionLiveState, key: string) =>
  state.versions[key] ?? state.base;

/** Last-writer-wins by seq. */
const wins = (state: MissionLiveState, key: string, seq: number) =>
  seq > versionOf(state, key);

/** Revisioned entities win by (revision, seq) so local responses are not reverted. */
const winsRevision = (
  state: MissionLiveState,
  key: string,
  seq: number,
  next: number,
  current: number | undefined
) => {
  if (current === undefined || next > current) {
    return true;
  }
  return next === current && wins(state, key, seq);
};

const setEntity = <K extends EntityCollection>(
  state: MissionLiveState,
  collection: K,
  entity: MissionLiveState[K][string],
  key: string,
  id: string,
  seq: number
): MissionLiveState => ({
  ...state,
  [collection]: { ...state[collection], [id]: entity },
  versions: { ...state.versions, [key]: seq },
});

type EntityCollection =
  | "agents"
  | "artifacts"
  | "assignments"
  | "operations"
  | "permissions"
  | "plans"
  | "questions";

const upsert = <K extends EntityCollection>(
  state: MissionLiveState,
  collection: K,
  entity: MissionLiveState[K][string] & { id: string },
  seq: number
) => {
  const key = `${collection}:${entity.id}`;
  return wins(state, key, seq)
    ? setEntity(state, collection, entity, key, entity.id, seq)
    : state;
};

const previewKindOf = (item: TranscriptItem): PreviewKind | null => {
  if (item.kind === "assistant") {
    return "text";
  }
  return item.kind === "thinking" ? "thinking" : null;
};

const PREVIEW_KINDS: readonly PreviewKind[] = ["text", "thinking"];

/** Agent statuses after which nothing more streams for earlier turns. */
const AGENT_STOPPED: ReadonlySet<Agent["status"]> = new Set([
  "failed",
  "interrupted",
  "stopped",
]);

/** Mission statuses reached only after every agent stopped streaming. */
const MISSION_STOPPED: ReadonlySet<Mission["status"]> = new Set([
  "archived",
  "completed",
  "failed",
  "interrupted",
  "paused",
  "stop_failed",
]);

/** Drops chunks at or below `through`; null when nothing is left. */
const trimPreview = (preview: StreamingPreview, through: number) => {
  const chunks: Record<number, string> = {};
  for (const [chunkSeq, text] of Object.entries(preview.chunks)) {
    if (Number(chunkSeq) > through) {
      chunks[Number(chunkSeq)] = text;
    }
  }
  return Object.keys(chunks).length > 0 ? { ...preview, chunks } : null;
};

const trimPreviews = (
  previews: Record<string, StreamingPreview>,
  through: number,
  matches: (preview: StreamingPreview) => boolean
) => {
  const out: Record<string, StreamingPreview> = {};
  for (const [messageId, preview] of Object.entries(previews)) {
    const kept = matches(preview) ? trimPreview(preview, through) : preview;
    if (kept) {
      out[messageId] = kept;
    }
  }
  return out;
};

const prunePreviews = (
  previews: Record<string, StreamingPreview>,
  item: TranscriptItem,
  kind: PreviewKind | null,
  seq: number
) => {
  const { [item.id]: _replaced, ...rest } = previews;
  return kind === null
    ? rest
    : trimPreviews(
        rest,
        seq,
        (preview) => preview.agentId === item.agentId && preview.kind === kind
      );
};

/**
 * Ends streaming for one agent (or every agent when `agentId` is null) through
 * `seq`: its unfinished previews are dropped and older deltas stay ignored,
 * so an interrupted or retracted message cannot reappear.
 */
const settle = (
  state: MissionLiveState,
  agentId: string | null,
  seq: number
): MissionLiveState => {
  if (agentId === null) {
    return {
      ...state,
      previews: trimPreviews(state.previews, seq, () => true),
      settled: Math.max(state.settled, seq),
    };
  }
  const finalized = { ...state.finalized };
  for (const kind of PREVIEW_KINDS) {
    const key = `${agentId}:${kind}`;
    finalized[key] = Math.max(finalized[key] ?? 0, seq);
  }
  return {
    ...state,
    finalized,
    previews: trimPreviews(
      state.previews,
      seq,
      (preview) => preview.agentId === agentId
    ),
  };
};

const applyTranscriptItem = (
  state: MissionLiveState,
  item: TranscriptItem,
  seq: number
): MissionLiveState => {
  const kind = previewKindOf(item);
  const finalKey = kind === null ? null : `${item.agentId}:${kind}`;
  const finalized =
    finalKey === null
      ? state.finalized
      : {
          ...state.finalized,
          [finalKey]: Math.max(state.finalized[finalKey] ?? 0, seq),
        };
  const key = `transcript:${item.id}`;
  const transcript = wins(state, key, seq)
    ? { ...state.transcript, [item.id]: item }
    : state.transcript;
  const versions = wins(state, key, seq)
    ? { ...state.versions, [key]: seq }
    : state.versions;
  return {
    ...state,
    finalized,
    previews: prunePreviews(
      state.previews,
      item,
      kind,
      finalized[finalKey ?? ""] ?? seq
    ),
    transcript,
    versions,
  };
};

const applyDelta = (
  state: MissionLiveState,
  data: {
    agentId: string;
    delta: string;
    kind: PreviewKind;
    messageId: string;
  },
  seq: number
): MissionLiveState => {
  const finalizedThrough = Math.max(
    state.settled,
    state.finalized[`${data.agentId}:${data.kind}`] ?? 0
  );
  if (state.transcript[data.messageId] || seq <= finalizedThrough) {
    return state;
  }
  const current = state.previews[data.messageId];
  if (current?.chunks[seq] !== undefined) {
    return state;
  }
  const preview: StreamingPreview = {
    agentId: data.agentId,
    chunks: { ...current?.chunks, [seq]: data.delta },
    kind: data.kind,
    messageId: data.messageId,
  };
  return {
    ...state,
    previews: { ...state.previews, [data.messageId]: preview },
  };
};

const applyMission = (
  state: MissionLiveState,
  mission: Mission,
  seq: number
) =>
  winsRevision(state, "mission", seq, mission.revision, state.mission.revision)
    ? { ...state, mission, versions: { ...state.versions, mission: seq } }
    : state;

const applyQueue = (state: MissionLiveState, item: QueueItem, seq: number) => {
  const key = `queue:${item.id}`;
  return winsRevision(
    state,
    key,
    seq,
    item.revision,
    state.queue[item.id]?.revision
  )
    ? {
        ...state,
        queue: { ...state.queue, [item.id]: item },
        versions: { ...state.versions, [key]: seq },
      }
    : state;
};

const applyTodos = (
  state: MissionLiveState,
  agentId: string | null,
  todos: readonly Todo[],
  seq: number
) => {
  const group = agentId ?? MISSION_TODOS;
  const key = `todos:${group}`;
  return wins(state, key, seq)
    ? {
        ...state,
        todos: { ...state.todos, [group]: todos },
        versions: { ...state.versions, [key]: seq },
      }
    : state;
};

const applyBody = (
  state: MissionLiveState,
  event: DaemonEvent
): MissionLiveState => {
  const { seq } = event;
  switch (event.type) {
    case "mission.updated": {
      const next = applyMission(state, event.data.mission, seq);
      return MISSION_STOPPED.has(event.data.mission.status)
        ? settle(next, null, seq)
        : next;
    }
    case "agent.updated": {
      const next = upsert(state, "agents", event.data.agent, seq);
      return AGENT_STOPPED.has(event.data.agent.status)
        ? settle(next, event.data.agent.id, seq)
        : next;
    }
    case "transcript.item": {
      return applyTranscriptItem(state, event.data.item, seq);
    }
    case "transcript.delta": {
      return applyDelta(state, event.data, seq);
    }
    case "plan.updated": {
      return upsert(state, "plans", event.data.plan, seq);
    }
    case "todos.updated": {
      return applyTodos(state, event.data.agentId, event.data.todos, seq);
    }
    case "assignment.updated": {
      return upsert(state, "assignments", event.data.assignment, seq);
    }
    case "question.updated": {
      return upsert(state, "questions", event.data.question, seq);
    }
    case "permission.updated": {
      return upsert(state, "permissions", event.data.request, seq);
    }
    case "queue.updated": {
      return applyQueue(state, event.data.item, seq);
    }
    case "artifact.created": {
      return upsert(state, "artifacts", event.data.artifact, seq);
    }
    case "operation.updated": {
      return upsert(state, "operations", event.data.operation, seq);
    }
    case "workspace.changed": {
      return seq > state.workspaceSeq
        ? { ...state, changedPaths: event.data.paths, workspaceSeq: seq }
        : state;
    }
    case "notice": {
      return {
        ...state,
        notices: {
          ...state.notices,
          [seq]: { ...event.data.notice, at: event.at, seq },
        },
      };
    }
    default: {
      return state;
    }
  }
};

/** Applies one event. Events for other missions or at/below the snapshot are dropped. */
export const applyEvent = (
  state: MissionLiveState,
  event: DaemonEvent
): MissionLiveState => {
  if (event.missionId !== state.mission.id || event.seq <= state.base) {
    return state;
  }
  const next = applyBody(state, event);
  return event.seq > next.applied ? { ...next, applied: event.seq } : next;
};

export const applyEvents = (
  state: MissionLiveState,
  events: readonly DaemonEvent[]
): MissionLiveState => {
  let next = state;
  for (const event of events.toSorted((a, b) => a.seq - b.seq)) {
    next = applyEvent(next, event);
  }
  return next;
};

/**
 * Mission streams are gap-free, so a batch that skips a seq after `applied`
 * means events were lost and the snapshot must be refetched.
 */
export const hasGap = (applied: number, events: readonly DaemonEvent[]) => {
  let expected = applied + 1;
  const seqs = events
    .map((event) => event.seq)
    .filter((seq) => seq > applied)
    .toSorted((a, b) => a - b);
  for (const seq of seqs) {
    if (seq > expected) {
      return true;
    }
    expected = Math.max(expected, seq + 1);
  }
  return false;
};

/** Merges an older transcript page (all below the snapshot cursor). */
export const prependTranscript = (
  state: MissionLiveState,
  items: readonly TranscriptItem[],
  hasMore: boolean
): MissionLiveState => {
  const transcript = { ...state.transcript };
  for (const item of items) {
    transcript[item.id] ??= item;
  }
  return { ...state, transcript, transcriptHasMore: hasMore };
};

/** A snapshot of a stopped mission or agent ends streaming through its cursor. */
const settleSnapshot = (
  state: MissionLiveState,
  snapshot: MissionSnapshot
): MissionLiveState => {
  let next = MISSION_STOPPED.has(snapshot.mission.status)
    ? settle(state, null, snapshot.cursor)
    : state;
  for (const agent of snapshot.agents) {
    if (AGENT_STOPPED.has(agent.status)) {
      next = settle(next, agent.id, snapshot.cursor);
    }
  }
  return next;
};

/** Replaces state with a fresh snapshot and replays retained events newer than it. */
export const rebase = (
  snapshot: MissionSnapshot,
  log: readonly DaemonEvent[],
  previous?: MissionLiveState | null
): MissionLiveState => {
  const next = fromSnapshot(snapshot);
  if (previous) {
    // History pages are immutable; refreshed authoritative copies still win.
    next.transcript = { ...previous.transcript, ...next.transcript };
    next.transcriptHasMore =
      previous.transcriptHasMore && next.transcriptHasMore;
    next.previews = previous.previews;
    next.finalized = previous.finalized;
    next.settled = previous.settled;
    next.notices = previous.notices;
    next.operations = previous.operations;
    const newest = Math.max(
      -1,
      ...Object.values(previous.transcript).map((item) => item.seq)
    );
    for (const item of snapshot.transcript) {
      if (item.seq > newest || next.previews[item.id]) {
        const kind = previewKindOf(item);
        next.previews = prunePreviews(
          next.previews,
          item,
          kind,
          snapshot.cursor
        );
        if (kind !== null) {
          next.finalized = {
            ...next.finalized,
            [`${item.agentId}:${kind}`]: Math.max(
              next.finalized[`${item.agentId}:${kind}`] ?? 0,
              snapshot.cursor
            ),
          };
        }
      }
    }
  }
  return applyEvents(settleSnapshot(next, snapshot), log);
};

type LocalEntity =
  | { kind: "mission"; value: Mission }
  | { kind: "permission"; value: PermissionRequest }
  | { kind: "plan"; value: PlanRevision }
  | { kind: "question"; value: Question }
  | { kind: "queue"; value: QueueItem };

const staleDecision = (
  current: { epoch: number; status: string } | undefined,
  next: { epoch: number; status: string }
) =>
  current !== undefined &&
  (current.epoch > next.epoch ||
    (current.status !== "pending" && next.status === "pending"));

/**
 * Applies a mutation response before its event arrives. It keeps the entity's
 * version, so the matching event (higher seq) still wins.
 */
export const applyLocal = (
  state: MissionLiveState,
  entity: LocalEntity
): MissionLiveState => {
  switch (entity.kind) {
    case "mission": {
      return entity.value.revision >= state.mission.revision
        ? { ...state, mission: entity.value }
        : state;
    }
    case "queue": {
      const current = state.queue[entity.value.id];
      return current && current.revision > entity.value.revision
        ? state
        : {
            ...state,
            queue: { ...state.queue, [entity.value.id]: entity.value },
          };
    }
    case "permission": {
      const current = state.permissions[entity.value.id];
      if (staleDecision(current, entity.value)) {
        return state;
      }
      return {
        ...state,
        permissions: { ...state.permissions, [entity.value.id]: entity.value },
      };
    }
    case "plan": {
      const current = state.plans[entity.value.id];
      if (
        current &&
        (current.revision > entity.value.revision ||
          (current.status !== "proposed" && entity.value.status === "proposed"))
      ) {
        return state;
      }
      return {
        ...state,
        plans: { ...state.plans, [entity.value.id]: entity.value },
      };
    }
    case "question": {
      const current = state.questions[entity.value.id];
      if (staleDecision(current, entity.value)) {
        return state;
      }
      return {
        ...state,
        questions: { ...state.questions, [entity.value.id]: entity.value },
      };
    }
    default: {
      return state;
    }
  }
};

export const previewText = (preview: StreamingPreview) =>
  Object.entries(preview.chunks)
    .toSorted(([a], [b]) => Number(a) - Number(b))
    .map(([, text]) => text)
    .join("");
