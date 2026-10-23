"use client";

import type { TranscriptItem } from "@missions/protocol/missions";
import { useState } from "react";

import { AssignmentCard } from "@/components/mission/assignment-card";
import { EventLine } from "@/components/mission/chat-cards";
import {
  BrainIcon,
  CheckIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  MergeIcon,
} from "@/components/mission/icons";
import { useMission } from "@/components/mission/mission-context";
import { PermissionCard } from "@/components/mission/permission-card";
import { PlanCard } from "@/components/mission/plan-card";
import { QuestionCard } from "@/components/mission/question-card";
import {
  CommandCard,
  EditCard,
  isCommandCard,
  isEditGroup,
  isRanRow,
  RanRow,
} from "@/components/mission/tool-cards";
import { IndentRule, ToolRun } from "@/components/mission/tool-group";
import { Callout } from "@/components/ui/callout";
import { Markdown } from "@/components/ui/markdown";
import { Spinner } from "@/components/ui/spinner";
import { groupTodos } from "@/lib/mission/overview";
import { goalRequestId } from "@/lib/mission/queue";
import type { TimelineEntry, ToolCall } from "@/lib/mission/timeline";

/** Paper user bubble: right-aligned, 480px max, overlay surface. */
export const UserMessage = ({ text }: { text: string }) => (
  <div className="max-w-120 self-end rounded-md bg-surface-overlay px-card py-control">
    <p className="max-w-prose text-sm leading-chat font-book tracking-tight text-pretty break-words whitespace-pre-wrap text-text">
      {text}
    </p>
  </div>
);

/** Paper I9X "Thought" row: a quiet disclosure over the reasoning text. */
const Thinking = ({ text }: { text: string }) => {
  const [open, setOpen] = useState(false);
  const Chevron = open ? ChevronDownIcon : ChevronRightIcon;
  return (
    <div className="flex flex-col gap-2xs">
      <button
        aria-expanded={open}
        className="flex h-2xl w-fit cursor-pointer items-center gap-md rounded-xs text-text-tertiary transition-colors duration-fast hover:text-text-secondary focus-visible:shadow-focus"
        onClick={() => setOpen(!open)}
        type="button"
      >
        <BrainIcon aria-hidden="true" className="size-3.5 shrink-0" />
        <span className="text-sm leading-sm font-book tracking-tight">
          Thought
        </span>
        <Chevron aria-hidden="true" className="size-3 shrink-0" />
      </button>
      {open ? (
        <div className="flex">
          <IndentRule />
          <p className="min-w-0 flex-1 py-xs pl-control text-xs leading-sm font-book tracking-tight whitespace-pre-wrap text-text-secondary">
            {text}
          </p>
        </div>
      ) : null}
    </div>
  );
};

/** Paper QAU: the worktree the mission runs in, under the goal. */
export const WorkspaceLine = () => {
  const { live } = useMission();
  const { workspace } = live.mission;
  if (!workspace) {
    return null;
  }
  const base = workspace.baseRef ? ` from ${workspace.baseRef}` : "";
  let text = `Working in ${workspace.path}`;
  if (workspace.mode === "new_worktree") {
    text = `New worktree · ${workspace.branch ?? workspace.path}${base}`;
  } else if (workspace.branch) {
    text = `Working on ${workspace.branch}`;
  }
  return <EventLine icon={<MergeIcon />}>{text}</EventLine>;
};

const PlanApproved = () => {
  const { live } = useMission();
  const todos = groupTodos(live.todos, live.agents).main.length;
  return (
    <EventLine icon={<CheckIcon />}>
      Plan approved
      {todos > 0 ? ` · ${todos} ${todos === 1 ? "todo" : "todos"}` : ""}
    </EventLine>
  );
};

const SystemLine = ({ text }: { text: string }) => (
  <EventLine icon={null}>{text}</EventLine>
);

type Row =
  | { entry: TimelineEntry; id: string; kind: "entry" }
  | { groups: ToolCall[][]; id: string; kind: "tools"; tail: boolean }
  | {
      calls: ToolCall[];
      card: "command" | "edit" | "ran";
      id: string;
      kind: "card";
    };

const cardOf = (calls: readonly ToolCall[], running: boolean) => {
  if (isCommandCard(calls, running)) {
    return "command";
  }
  if (isRanRow(calls)) {
    return "ran";
  }
  return isEditGroup(calls) ? "edit" : null;
};

const EntryBody = ({ entry }: { entry: TimelineEntry }) => {
  switch (entry.kind) {
    case "user": {
      return <UserMessage text={entry.item.text} />;
    }
    case "assistant": {
      return <Markdown className="max-w-prose">{entry.item.text}</Markdown>;
    }
    case "thinking": {
      return <Thinking text={entry.item.text} />;
    }
    case "system": {
      return <SystemLine text={entry.item.text} />;
    }
    case "error": {
      return (
        <Callout title="The agent hit an error" tone="danger">
          {entry.item.text}
        </Callout>
      );
    }
    case "preview": {
      return entry.previewKind === "thinking" ? (
        <div className="flex h-2xl items-center gap-md text-sm leading-sm font-book tracking-tight text-text-tertiary">
          <Spinner label="Thinking" size="sm" />
          Thinking…
        </div>
      ) : (
        <Markdown className="max-w-prose">{entry.text}</Markdown>
      );
    }
    case "permission": {
      return <PermissionCard request={entry.request} />;
    }
    case "plan": {
      return <PlanCard latest={entry.latest} plan={entry.plan} />;
    }
    case "plan_approved": {
      return <PlanApproved />;
    }
    case "question": {
      return <QuestionCard question={entry.question} />;
    }
    case "assignment": {
      return <AssignmentCard assignment={entry.assignment} />;
    }
    default: {
      return null;
    }
  }
};

/** Worker narration and tool calls live in their assignment card, as in Paper S22. */
const WORKER_HIDDEN = new Set<TimelineEntry["kind"]>([
  "assistant",
  "preview",
  "thinking",
  "tools",
]);

/**
 * Folds consecutive tool groups from one agent into a single run. Lone
 * commands and edits break out as their own cards.
 */
const toRows = (entries: readonly TimelineEntry[], running: boolean) => {
  const rows: Row[] = [];
  for (const entry of entries) {
    const last = rows.at(-1);
    if (entry.kind !== "tools") {
      rows.push({ entry, id: entry.id, kind: "entry" });
      continue;
    }
    const card = cardOf(entry.calls, running);
    if (card) {
      rows.push({ calls: entry.calls, card, id: entry.id, kind: "card" });
      continue;
    }
    if (last?.kind === "tools" && last.id.startsWith(`${entry.agentId}|`)) {
      last.groups.push(entry.calls);
      continue;
    }
    rows.push({
      groups: [entry.calls],
      id: `${entry.agentId}|${entry.id}`,
      kind: "tools",
      tail: false,
    });
  }
  const lastRow = rows.at(-1);
  if (lastRow?.kind === "tools") {
    lastRow.tail = true;
  }
  return rows;
};

const isGoal = (item: TranscriptItem, missionId: string) =>
  item.kind === "user" && item.requestId === goalRequestId(missionId);

/**
 * The Orchestrator's side of the mission: messages, tool runs, and decision
 * cards. The worktree line follows the goal.
 */
export const Transcript = ({
  entries,
  running,
}: {
  entries: readonly TimelineEntry[];
  running: boolean;
}) => {
  const { live, missionId } = useMission();
  const visible = entries.filter(
    (entry) =>
      !(
        entry.agentId !== null &&
        WORKER_HIDDEN.has(entry.kind) &&
        live.agents[entry.agentId]?.role === "worker"
      )
  );
  const rows = toRows(visible, running);
  return (
    <ol aria-label="Mission transcript" className="flex flex-col gap-section">
      {rows.map((row) => {
        if (row.kind === "card") {
          return (
            <li className="flex min-w-0 flex-col gap-md" key={row.id}>
              {row.calls.map((call) => {
                if (row.card === "command") {
                  return <CommandCard call={call} key={call.id} />;
                }
                return row.card === "ran" ? (
                  <RanRow call={call} key={call.id} />
                ) : (
                  <EditCard call={call} key={call.id} />
                );
              })}
            </li>
          );
        }
        if (row.kind === "tools") {
          return (
            <li className="flex min-w-0 flex-col gap-2xs" key={row.id}>
              <ToolRun
                autoOpen={running && row.tail}
                groups={row.groups}
                running={running}
              />
            </li>
          );
        }
        const { entry } = row;
        const goal = entry.kind === "user" && isGoal(entry.item, missionId);
        return (
          <li className="flex min-w-0 flex-col gap-section" key={row.id}>
            <EntryBody entry={entry} />
            {goal ? <WorkspaceLine /> : null}
          </li>
        );
      })}
    </ol>
  );
};
