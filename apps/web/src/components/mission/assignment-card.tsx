"use client";

import type { Assignment, Todo } from "@missions/protocol/missions";

import { ChatCard, ChatCardHeader } from "@/components/mission/chat-cards";
import {
  CheckIcon,
  CircleIcon,
  CloseIcon,
  PauseIcon,
  WarningIcon,
} from "@/components/mission/icons";
import { useMission } from "@/components/mission/mission-context";
import { DotLoader, IconCell } from "@/components/mission/panel-kit";
import type { BadgeTone } from "@/components/ui/badge";
import { formatDuration } from "@/lib/format";
import { groupTodos } from "@/lib/mission/overview";
import { useNow } from "@/lib/use-now";
import { cn } from "@/lib/utils";

type RowState =
  | "blocked"
  | "done"
  | "failed"
  | "paused"
  | "pending"
  | "working";

const STATUS: Record<Assignment["status"], { label: string; tone: BadgeTone }> =
  {
    cancelled: { label: "Stopped", tone: "muted" },
    failed: { label: "Failed", tone: "danger" },
    handed_off: { label: "Done", tone: "success" },
    queued: { label: "Queued", tone: "muted" },
    running: { label: "Running", tone: "accent" },
  };

const RowIcon = ({ state }: { state: RowState }) => {
  switch (state) {
    case "working": {
      return <DotLoader label="In progress" />;
    }
    case "done": {
      return <CheckIcon className="size-3.5 text-text-tertiary" />;
    }
    case "failed": {
      return <CloseIcon className="size-3.5 text-danger" />;
    }
    case "blocked": {
      return <WarningIcon className="size-3.5 text-danger" />;
    }
    case "paused": {
      return <PauseIcon className="size-3.5 text-text-tertiary" />;
    }
    default: {
      return <CircleIcon className="text-text-disabled" />;
    }
  }
};

const RIGHT_LABEL: Partial<Record<RowState, string>> = {
  blocked: "Blocked",
  failed: "Failed",
  paused: "Paused",
};

const TodoLine = ({
  agent,
  elapsed,
  state,
  title,
}: {
  agent: string;
  elapsed: string | null;
  state: RowState;
  title: string;
}) => (
  <li className="flex h-9 shrink-0 items-center gap-control px-card">
    <IconCell>
      <RowIcon state={state} />
    </IconCell>
    <span
      className={cn(
        "min-w-0 flex-1 truncate text-sm leading-sm tracking-tight",
        state === "pending" || state === "done"
          ? "font-book text-text-secondary"
          : "text-text",
        state === "working" || state === "paused" ? "font-medium" : "font-book"
      )}
    >
      {title}
    </span>
    <span className="shrink-0 text-xs leading-sm font-book tracking-tight text-text-tertiary">
      {agent}
    </span>
    {RIGHT_LABEL[state] ? (
      <span
        className={cn(
          "flex w-14 shrink-0 justify-end font-mono text-2xs leading-xs",
          state === "failed" ? "text-danger" : "text-text-tertiary"
        )}
      >
        {RIGHT_LABEL[state]}
      </span>
    ) : null}
    {elapsed && !RIGHT_LABEL[state] ? (
      <span className="flex w-14 shrink-0 justify-end font-mono text-2xs leading-xs text-text-tertiary">
        {elapsed}
      </span>
    ) : null}
  </li>
);

const PROGRESS: Record<Todo["status"], number> = {
  completed: 2,
  in_progress: 1,
  pending: 0,
};

/** The further of the worker's and the Orchestrator's status for the same todo. */
const settledStatus = (todo: Todo, main: readonly Todo[]) => {
  const mirrored = main.find((entry) => entry.content === todo.content);
  return mirrored && PROGRESS[mirrored.status] > PROGRESS[todo.status]
    ? mirrored.status
    : todo.status;
};

/** "Todos 1–2" when the worker's checklist matches mission todos, else the assignment title. */
const cardTitle = (
  assignment: Assignment,
  workerTodos: readonly Todo[],
  main: readonly Todo[]
) => {
  const indices = workerTodos
    .map((todo) => main.findIndex((entry) => entry.content === todo.content))
    .filter((index) => index !== -1)
    .toSorted((a, b) => a - b);
  const [first] = indices;
  const last = indices.at(-1);
  if (first === undefined || last === undefined) {
    return assignment.title;
  }
  return first === last
    ? `Todo ${first + 1}`
    : `Todos ${first + 1}–${last + 1}`;
};

/** Paper S22: a dispatched assignment and its todos, inline in the chat. */
export const AssignmentCard = ({ assignment }: { assignment: Assignment }) => {
  const { live } = useMission();
  const now = useNow();
  const workerId = assignment.workerAgentId;
  const agent = workerId ? live.agents[workerId] : undefined;
  const workerTodos = workerId ? (live.todos[workerId] ?? []) : [];
  const { main } = groupTodos(live.todos, live.agents);
  const paused =
    live.mission.status === "paused" || live.mission.status === "pausing";
  const blocked =
    assignment.status === "running" &&
    live.mission.lastError?.code === "environment" &&
    agent?.status === "idle";
  let status = STATUS[assignment.status];
  // Pausing cancels the running assignment; it resumes with the mission.
  if (
    paused &&
    (assignment.status === "running" || assignment.status === "cancelled")
  ) {
    status = { label: "Paused", tone: "muted" };
  }
  const running = assignment.status === "running";
  const elapsed = formatDuration(
    (running ? now : Date.parse(assignment.updatedAt)) -
      Date.parse(assignment.createdAt)
  );

  const stateOf = (todoStatus: Todo["status"] | "running"): RowState => {
    if (todoStatus === "completed") {
      return "done";
    }
    if (todoStatus === "pending") {
      return "pending";
    }
    if (assignment.status === "failed") {
      return "failed";
    }
    if (blocked) {
      return "blocked";
    }
    if (paused) {
      return "paused";
    }
    return running ? "working" : "done";
  };

  const rows =
    workerTodos.length > 0
      ? workerTodos.toSorted((a, b) => a.position - b.position)
      : null;

  return (
    <ChatCard label={cardTitle(assignment, workerTodos, main)}>
      <ChatCardHeader gap="md" status={status}>
        {cardTitle(assignment, workerTodos, main)}
      </ChatCardHeader>
      <ul className="flex flex-col">
        {rows ? (
          rows.map((todo) => {
            const todoStatus = settledStatus(todo, main);
            return (
              <TodoLine
                agent="Worker"
                elapsed={
                  todoStatus === "in_progress" && running ? elapsed : null
                }
                key={todo.id}
                state={stateOf(todoStatus)}
                title={todo.content}
              />
            );
          })
        ) : (
          <TodoLine
            agent="Worker"
            elapsed={elapsed}
            state={stateOf(
              assignment.status === "handed_off" ? "completed" : "running"
            )}
            title={assignment.title}
          />
        )}
      </ul>
    </ChatCard>
  );
};
