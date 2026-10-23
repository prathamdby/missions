import type {
  Agent,
  AgentStatus,
  Assignment,
  Handoff,
  Todo,
} from "@missions/protocol/missions";

import { MISSION_TODOS } from "../live/mission-state";

export interface WorkerTodos {
  agentId: string;
  todos: readonly Todo[];
}

export interface TodoGroups {
  /** The mission plan: the Orchestrator's (or mission-wide) list. */
  main: readonly Todo[];
  /** Each Worker's own checklist for its assignment. */
  workers: readonly WorkerTodos[];
}

const byPosition = (todos: readonly Todo[]) =>
  todos.toSorted((a, b) => a.position - b.position);

/**
 * Mission todos first: `agentId: null` todos if the daemon sends any,
 * otherwise the Orchestrator's. Worker lists stay separate so the same task
 * never shows twice in the main list.
 */
export const groupTodos = (
  todos: Readonly<Record<string, readonly Todo[]>>,
  agents: Readonly<Record<string, Agent>>
): TodoGroups => {
  const orchestrator = Object.values(agents).find(
    (agent) => agent.role === "orchestrator"
  );
  const shared = todos[MISSION_TODOS] ?? [];
  let mainKey: string | null = null;
  if (shared.length > 0) {
    mainKey = MISSION_TODOS;
  } else if (orchestrator && (todos[orchestrator.id]?.length ?? 0) > 0) {
    mainKey = orchestrator.id;
  }
  const workers = Object.entries(todos)
    .filter(
      ([key, list]) =>
        key !== mainKey &&
        key !== MISSION_TODOS &&
        key !== orchestrator?.id &&
        list.length > 0
    )
    .map(([agentId, list]) => ({ agentId, todos: byPosition(list) }))
    .toSorted((a, b) =>
      (agents[a.agentId]?.createdAt ?? "").localeCompare(
        agents[b.agentId]?.createdAt ?? ""
      )
    );
  return {
    main: mainKey === null ? [] : byPosition(todos[mainKey] ?? []),
    workers,
  };
};

/** Mission checklist first; worker checklists only stand in when it is absent. */
export const todoProgress = (
  todos: Readonly<Record<string, readonly Todo[]>>,
  agents: Readonly<Record<string, Agent>>
) => {
  const groups = groupTodos(todos, agents);
  const items =
    groups.main.length > 0
      ? groups.main
      : groups.workers.flatMap((worker) => worker.todos);
  return {
    done: items.filter((todo) => todo.status === "completed").length,
    groups,
    items,
    total: items.length,
  };
};

export type AgentPhase =
  | "blocked"
  | "done"
  | "failed"
  | "idle"
  | "needs_you"
  | "stopped"
  | "working";

export interface AgentRow {
  /** What the agent is on: its assignment, or its current todo. */
  activity: string;
  /** Null while the agent is still running. */
  endedAt: string | null;
  handoff: Handoff | null;
  id: string;
  label: string;
  phase: AgentPhase;
  role: Agent["role"];
  startedAt: string;
}

const LIVE: ReadonlySet<AgentStatus> = new Set([
  "starting",
  "working",
  "stopping",
  "waiting_answer",
  "waiting_permission",
]);

const phaseOf = (
  agent: Agent,
  assignment: Assignment | undefined
): AgentPhase => {
  if (
    agent.status === "waiting_answer" ||
    agent.status === "waiting_permission"
  ) {
    return "needs_you";
  }
  if (agent.status === "working" || agent.status === "starting") {
    return "working";
  }
  if (agent.status === "failed" || assignment?.status === "failed") {
    return "failed";
  }
  if (assignment?.status === "handed_off") {
    return "done";
  }
  if (agent.status === "idle") {
    return "idle";
  }
  return "stopped";
};

export interface RowContext {
  /** The plan is proposed and waits for the user's decision. */
  awaitingApproval: boolean;
  /** The mission's last error is an environment failure (Paper V69). */
  environmentBlocked: boolean;
  /** When the user approved a plan; null while the Orchestrator still plans. */
  planApprovedAt: string | null;
}

const PLANNING = "Explore and plan";

/** `own` is the Orchestrator's assignment or current todo, when it has one. */
const orchestratorRow = (
  agent: Agent,
  row: AgentRow,
  own: string | null,
  context: RowContext
): AgentRow => {
  if (context.planApprovedAt === null) {
    return {
      ...row,
      activity: own ?? PLANNING,
      phase: context.awaitingApproval ? "needs_you" : row.phase,
    };
  }
  // Once the plan is approved an idle Orchestrator's row records the
  // planning phase it finished (Paper S22).
  if (own === null && !LIVE.has(agent.status)) {
    return {
      ...row,
      activity: PLANNING,
      endedAt: context.planApprovedAt,
      phase: "done",
    };
  }
  return { ...row, activity: own ?? "Plans and reviews" };
};

/** An idle Worker whose assignment is still open stalled on its environment. */
const workerRow = (
  row: AgentRow,
  assignment: Assignment | undefined,
  context: RowContext
): AgentRow =>
  context.environmentBlocked &&
  row.phase === "idle" &&
  assignment?.status === "running"
    ? { ...row, phase: "blocked" }
    : row;

/**
 * One row per agent for the Overview, newest first. The status comes from
 * `agent.status`; `workingState` is a free-form hint that can go stale after
 * a stop.
 */
export const agentRows = (
  agents: Readonly<Record<string, Agent>>,
  assignments: Readonly<Record<string, Assignment>>,
  todos: Readonly<Record<string, readonly Todo[]>>,
  labels: Readonly<Record<string, string>>,
  context: RowContext
): AgentRow[] =>
  Object.values(agents)
    .toSorted((a, b) => b.createdAt.localeCompare(a.createdAt))
    .map((agent) => {
      const assignment = agent.assignmentId
        ? assignments[agent.assignmentId]
        : undefined;
      const current = todos[agent.id]?.find(
        (todo) => todo.status === "in_progress"
      );
      const own = assignment?.title ?? current?.content ?? null;
      const label = labels[agent.id] ?? agent.title;
      const live = LIVE.has(agent.status);
      const row: AgentRow = {
        activity: own ?? label,
        endedAt: live ? null : (assignment?.updatedAt ?? agent.updatedAt),
        handoff: assignment?.handoff ?? null,
        id: agent.id,
        label,
        phase: phaseOf(agent, assignment),
        role: agent.role,
        startedAt: assignment?.createdAt ?? agent.createdAt,
      };
      // The Orchestrator's todos are the mission plan that Workers carry out,
      // so they never describe what the Orchestrator itself is doing.
      return agent.role === "orchestrator"
        ? orchestratorRow(agent, row, assignment?.title ?? null, context)
        : workerRow(row, assignment, context);
    });
