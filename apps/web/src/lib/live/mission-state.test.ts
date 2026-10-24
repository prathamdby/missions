import type { DaemonEvent } from "@missions/protocol/events";
import type {
  Agent,
  Mission,
  MissionSnapshot,
  PermissionRequest,
  QueueItem,
  TranscriptItem,
} from "@missions/protocol/missions";
import { describe, expect, it } from "vitest";

import {
  applyEvent,
  applyEvents,
  applyLocal,
  fromSnapshot,
  hasGap,
  prependTranscript,
  previewText,
  rebase,
} from "./mission-state";
import type { MissionLiveState } from "./mission-state";

const MISSION_ID = "m-1";
const AT = "2026-01-01T00:00:00.000Z";
const CURSOR = 10;

const mission = (
  revision: number,
  status: Mission["status"] = "running"
): Mission => ({
  createdAt: AT,
  endedAt: null,
  epoch: 0,
  executionMode: "work",
  goal: "Fix the flaky test",
  id: MISSION_ID,
  lastError: null,
  orchestrator: { modelId: "opus", reasoningEffort: "high" },
  pendingExecutionMode: null,
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
  status,
  summary: null,
  title: "Fix flaky test",
  updatedAt: AT,
  worker: { modelId: "sonnet", reasoningEffort: "medium" },
  workspace: null,
});

const agent = (status: Agent["status"]): Agent => ({
  assignmentId: null,
  createdAt: AT,
  holdsWriteLease: false,
  id: "a-orch",
  missionId: MISSION_ID,
  model: { modelId: "opus", reasoningEffort: "high" },
  previousSessionIds: [],
  promptVersion: null,
  role: "orchestrator",
  sessionGeneration: 0,
  sessionId: "s-1",
  status,
  title: "Orchestrator",
  updatedAt: AT,
  waitingReason: null,
  workingState: null,
});

const queueItem = (revision: number, state: QueueItem["state"]): QueueItem => ({
  agentId: "a-orch",
  createdAt: AT,
  error: null,
  executionMode: null,
  id: "q-1",
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
  text: "Then open a draft PR",
  updatedAt: AT,
});

const permission = (
  status: PermissionRequest["status"]
): PermissionRequest => ({
  agentId: "a-orch",
  allowAlways: true,
  createdAt: AT,
  decidedAt: status === "pending" ? null : AT,
  decision: status === "approved" ? "approve_once" : null,
  epoch: 0,
  id: "perm-1",
  kind: "tool",
  missionId: MISSION_ID,
  reason: null,
  status,
  toolUses: [],
});

const item = (
  id: string,
  kind: TranscriptItem["kind"],
  text: string,
  seq: number
): TranscriptItem => ({
  agentId: "a-orch",
  createdAt: AT,
  id,
  isError: false,
  kind,
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

const snapshot = (
  overrides: Partial<MissionSnapshot> = {}
): MissionSnapshot => ({
  agents: [agent("idle")],
  artifacts: [],
  assignments: [],
  cursor: CURSOR,
  mission: mission(1),
  permissions: [],
  plans: [],
  questions: [],
  queue: [],
  todos: [],
  transcript: [item("t-0", "user", "Fix it", 0)],
  transcriptHasMore: false,
  ...overrides,
});

type Body = DaemonEvent extends infer E
  ? E extends DaemonEvent
    ? Omit<E, "at" | "missionId" | "seq">
    : never
  : never;

const event = (
  seq: number,
  body: Body,
  missionId: string | null = MISSION_ID
) => ({ ...body, at: AT, missionId, seq }) as DaemonEvent;

const todo = (id: string, status: "completed" | "in_progress" | "pending") => ({
  agentId: null,
  content: `Todo ${id}`,
  id,
  missionId: MISSION_ID,
  position: 0,
  priority: "medium" as const,
  status,
});

const EVENTS: DaemonEvent[] = [
  event(11, { data: { mission: mission(2) }, type: "mission.updated" }),
  event(12, { data: { agent: agent("working") }, type: "agent.updated" }),
  event(13, {
    data: { agentId: "a-orch", delta: "Hel", kind: "text", messageId: "msg-1" },
    type: "transcript.delta",
  }),
  event(14, {
    data: { agentId: "a-orch", delta: "lo ", kind: "text", messageId: "msg-1" },
    type: "transcript.delta",
  }),
  event(15, { data: { item: queueItem(1, "queued") }, type: "queue.updated" }),
  event(16, {
    data: {
      agentId: "a-orch",
      delta: "world",
      kind: "text",
      messageId: "msg-1",
    },
    type: "transcript.delta",
  }),
  event(17, {
    data: { item: item("msg-1", "assistant", "Hello world", 1) },
    type: "transcript.item",
  }),
  event(18, {
    data: { request: permission("pending") },
    type: "permission.updated",
  }),
  event(19, {
    data: { agentId: null, todos: [todo("td-1", "in_progress")] },
    type: "todos.updated",
  }),
  event(20, {
    data: {
      agentId: "a-orch",
      delta: "Next",
      kind: "text",
      messageId: "msg-2",
    },
    type: "transcript.delta",
  }),
  event(21, { data: { item: queueItem(2, "sent") }, type: "queue.updated" }),
  event(22, {
    data: { request: permission("approved") },
    type: "permission.updated",
  }),
  event(23, {
    data: { agentId: null, todos: [todo("td-1", "completed")] },
    type: "todos.updated",
  }),
  event(24, {
    data: {
      notice: {
        code: "info",
        level: "info",
        message: "Saved plan",
        retryAfterMs: null,
      },
    },
    type: "notice",
  }),
  event(25, { data: { paths: ["src/a.ts"] }, type: "workspace.changed" }),
  event(26, {
    data: { mission: mission(3, "paused") },
    type: "mission.updated",
  }),
  event(27, { data: { agent: agent("idle") }, type: "agent.updated" }),
];

const fold = (state: MissionLiveState, events: readonly DaemonEvent[]) => {
  let next = state;
  for (const entry of events) {
    next = applyEvent(next, entry);
  }
  return next;
};

// Park-Miller PRNG so failures reproduce.
const MODULUS = 2_147_483_647;
const MULTIPLIER = 16_807;
const prng = (seed: number) => {
  let value = seed;
  return () => {
    value = (value * MULTIPLIER) % MODULUS;
    return (value - 1) / (MODULUS - 1);
  };
};

const shuffle = <T>(items: readonly T[], seed: number) => {
  const random = prng(seed);
  const out = [...items];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j] as T, out[i] as T];
  }
  return out;
};

const pick = (state: MissionLiveState) => ({
  agents: state.agents,
  applied: state.applied,
  mission: state.mission,
  permissions: state.permissions,
  previews: state.previews,
  queue: state.queue,
  todos: state.todos,
  transcript: state.transcript,
});

const reference = fold(fromSnapshot(snapshot()), EVENTS);

describe("mission live state", () => {
  it("applies an in-order stream", () => {
    expect({
      agent: reference.agents["a-orch"]?.status,
      applied: reference.applied,
      changedPaths: reference.changedPaths,
      mission: [reference.mission.revision, reference.mission.status],
      notices: Object.keys(reference.notices),
      permission: reference.permissions["perm-1"]?.status,
      previews: Object.keys(reference.previews),
      queue: reference.queue["q-1"]?.state,
      todo: reference.todos.mission?.[0]?.status,
      transcript: reference.transcript["msg-1"]?.text,
    }).toStrictEqual({
      agent: "idle",
      applied: 27,
      changedPaths: ["src/a.ts"],
      mission: [3, "paused"],
      notices: ["24"],
      permission: "approved",
      // msg-2 never finalized before the mission paused at seq 26.
      previews: [],
      queue: "sent",
      todo: "completed",
      transcript: "Hello world",
    });
  });

  it("converges when events arrive out of order, one at a time", () => {
    for (let seed = 1; seed <= 200; seed += 1) {
      expect(
        fold(fromSnapshot(snapshot()), shuffle(EVENTS, seed))
      ).toStrictEqual(reference);
    }
  });

  it("is idempotent under duplicate delivery and replays", () => {
    for (let seed = 1; seed <= 100; seed += 1) {
      const noisy = shuffle(
        [...EVENTS, ...EVENTS, ...EVENTS.slice(3, 9)],
        seed
      );
      expect(fold(fromSnapshot(snapshot()), noisy)).toStrictEqual(reference);
    }
    expect(fold(reference, EVENTS)).toStrictEqual(reference);
  });

  it("batches converge regardless of arrival order", () => {
    for (let seed = 1; seed <= 50; seed += 1) {
      const shuffled = shuffle(EVENTS, seed);
      const half = Math.floor(shuffled.length / 2);
      const batched = applyEvents(
        applyEvents(fromSnapshot(snapshot()), shuffled.slice(0, half)),
        shuffled.slice(half)
      );
      expect(batched).toStrictEqual(reference);
    }
  });

  it("drops events already reflected in the snapshot and other missions' events", () => {
    const stale = event(9, {
      data: { mission: mission(9, "failed") },
      type: "mission.updated",
    });
    const foreign = event(
      30,
      { data: { agent: agent("failed") }, type: "agent.updated" },
      "m-2"
    );
    const global = event(
      31,
      { data: { paths: ["x"] }, type: "workspace.changed" },
      null
    );
    const state = fold(fromSnapshot(snapshot()), [stale, foreign, global]);
    expect(state).toStrictEqual(fromSnapshot(snapshot()));
  });

  it("coalesces deltas into a preview replaced by the authoritative item", () => {
    const streaming = fold(fromSnapshot(snapshot()), EVENTS.slice(2, 4));
    const preview = streaming.previews["msg-1"];
    expect(preview && previewText(preview)).toBe("Hello ");
    const done = applyEvent(streaming, EVENTS[6] as DaemonEvent);
    expect(done.previews["msg-1"]).toBeUndefined();
    expect(done.transcript["msg-1"]?.text).toBe("Hello world");
    const late = applyEvent(done, EVENTS[5] as DaemonEvent);
    expect(late.previews).toStrictEqual({});
  });

  it("supersedes previews whose message id differs from the final item", () => {
    const deltas = [
      event(11, {
        data: {
          agentId: "a-orch",
          delta: "Draft",
          kind: "text",
          messageId: "stream-1",
        },
        type: "transcript.delta",
      }),
      event(12, {
        data: { item: item("final-1", "assistant", "Draft", 1) },
        type: "transcript.item",
      }),
    ];
    for (const order of [deltas, deltas.toReversed()]) {
      const state = fold(fromSnapshot(snapshot()), order);
      expect(state.previews).toStrictEqual({});
      expect(state.transcript["final-1"]?.text).toBe("Draft");
    }
  });

  it("never resurrects a finalized thinking preview from late or replayed deltas", () => {
    const thinking = (seq: number, delta: string, messageId = "think-1") =>
      event(seq, {
        data: { agentId: "a-orch", delta, kind: "thinking", messageId },
        type: "transcript.delta",
      });
    const final = event(13, {
      data: { item: item("think-1", "thinking", "Plan the fix", 13) },
      type: "transcript.item",
    });
    const streaming = fold(fromSnapshot(snapshot()), [
      thinking(11, "Plan "),
      thinking(12, "the fix"),
    ]);
    const preview = streaming.previews["think-1"];
    expect(preview && [preview.kind, previewText(preview)]).toStrictEqual([
      "thinking",
      "Plan the fix",
    ]);
    const done = applyEvent(streaming, final);
    expect(done.previews).toStrictEqual({});
    const replayed = fold(done, [
      thinking(11, "Plan "),
      thinking(12, "the fix"),
      thinking(14, " again"),
    ]);
    expect(replayed.previews).toStrictEqual({});
    expect(replayed.transcript["think-1"]?.text).toBe("Plan the fix");
    const next = applyEvent(replayed, thinking(15, "Next", "think-2"));
    expect(Object.keys(next.previews)).toStrictEqual(["think-2"]);
  });

  it("drops an interrupted agent's preview and ignores its late deltas in any order", () => {
    const delta = event(11, {
      data: {
        agentId: "a-orch",
        delta: "Half a sen",
        kind: "text",
        messageId: "cut-1",
      },
      type: "transcript.delta",
    });
    const interrupted = event(12, {
      data: { agent: agent("interrupted") },
      type: "agent.updated",
    });
    for (const order of [
      [delta, interrupted],
      [interrupted, delta],
    ]) {
      const state = fold(fromSnapshot(snapshot()), [...order, delta]);
      expect(state.previews).toStrictEqual({});
    }
    const resumed = fold(fromSnapshot(snapshot()), [
      delta,
      interrupted,
      event(13, {
        data: {
          agentId: "a-orch",
          delta: "Retrying",
          kind: "text",
          messageId: "cut-2",
        },
        type: "transcript.delta",
      }),
    ]);
    expect(Object.keys(resumed.previews)).toStrictEqual(["cut-2"]);
  });

  it("drops every agent's unfinished preview when the mission pauses", () => {
    const state = fold(fromSnapshot(snapshot()), [
      event(11, {
        data: {
          agentId: "a-orch",
          delta: "Orchestrating",
          kind: "text",
          messageId: "o-1",
        },
        type: "transcript.delta",
      }),
      event(12, {
        data: {
          agentId: "a-worker",
          delta: "Thinking",
          kind: "thinking",
          messageId: "w-1",
        },
        type: "transcript.delta",
      }),
      event(13, {
        data: { mission: mission(2, "paused") },
        type: "mission.updated",
      }),
    ]);
    expect(state.previews).toStrictEqual({});
  });

  it("a reconnect onto a stopped mission drops previews streamed before the snapshot", () => {
    const streaming = fold(fromSnapshot(snapshot()), [
      event(11, {
        data: {
          agentId: "a-orch",
          delta: "Partial",
          kind: "text",
          messageId: "p-1",
        },
        type: "transcript.delta",
      }),
    ]);
    expect(Object.keys(streaming.previews)).toStrictEqual(["p-1"]);
    const stopped = snapshot({
      cursor: 12,
      mission: mission(2, "interrupted"),
    });
    expect(rebase(stopped, [], streaming).previews).toStrictEqual({});
    const running = snapshot({ cursor: 12, mission: mission(2) });
    expect(Object.keys(rebase(running, [], streaming).previews)).toStrictEqual([
      "p-1",
    ]);
  });

  it("rebases onto a newer snapshot and replays only newer events", () => {
    const midpoint = fold(fromSnapshot(snapshot()), EVENTS.slice(0, 9));
    const newer = snapshot({
      agents: Object.values(midpoint.agents),
      cursor: midpoint.applied,
      mission: midpoint.mission,
      permissions: Object.values(midpoint.permissions),
      queue: Object.values(midpoint.queue),
      todos: midpoint.todos.mission ? [...midpoint.todos.mission] : [],
      transcript: Object.values(midpoint.transcript),
    });
    const rebased = rebase(newer, EVENTS);
    expect(pick(rebased)).toStrictEqual(pick(reference));
  });

  it("keeps a local mutation result until a newer event arrives", () => {
    const base = fold(fromSnapshot(snapshot()), [EVENTS[4] as DaemonEvent]);
    const local = applyLocal(base, {
      kind: "queue",
      value: queueItem(2, "removing"),
    });
    expect(local.queue["q-1"]?.state).toBe("removing");
    const replay = applyEvent(local, EVENTS[4] as DaemonEvent);
    expect(replay.queue["q-1"]?.state).toBe("removing");
    const confirmed = applyEvent(
      local,
      event(40, {
        data: { item: queueItem(3, "removed") },
        type: "queue.updated",
      })
    );
    expect(confirmed.queue["q-1"]?.state).toBe("removed");
  });

  it("detects skipped sequence numbers but tolerates duplicates and reordering", () => {
    expect(hasGap(CURSOR, shuffle(EVENTS, 7))).toBeFalsy();
    expect(
      hasGap(CURSOR, [...EVENTS.slice(0, 4), ...EVENTS.slice(2)])
    ).toBeFalsy();
    expect(hasGap(CURSOR, EVENTS.slice(1))).toBeTruthy();
    expect(
      hasGap(CURSOR, [EVENTS[0], EVENTS[2]] as DaemonEvent[])
    ).toBeTruthy();
    expect(hasGap(30, EVENTS)).toBeFalsy();
  });

  it("merges an older transcript page without overwriting newer copies", () => {
    const state = fromSnapshot(snapshot());
    const older = [
      item("t-old", "user", "Earlier", 0),
      item("t-0", "user", "stale", 0),
    ];
    const merged = prependTranscript(state, older, false);
    expect(Object.keys(merged.transcript).toSorted()).toStrictEqual([
      "t-0",
      "t-old",
    ]);
    expect(merged.transcript["t-0"]?.text).toBe("Fix it");
    expect(merged.transcriptHasMore).toBeFalsy();
  });
});
