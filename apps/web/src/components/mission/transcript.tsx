"use client";

import type { TranscriptItem } from "@missions/protocol/missions";
import { useEffect } from "react";

import { AttachmentPreview } from "@/components/composer/attachment-chips";
import { AgentMessages } from "@/components/mission/agent-message";
import { AssignmentCard } from "@/components/mission/assignment-card";
import { EventLine } from "@/components/mission/chat-cards";
import { CheckIcon, MergeIcon } from "@/components/mission/icons";
import { useMission } from "@/components/mission/mission-context";
import { PermissionCard } from "@/components/mission/permission-card";
import { PlanCard } from "@/components/mission/plan-card";
import { QuestionCard } from "@/components/mission/question-card";
import { Thinking } from "@/components/mission/thinking";
import { CommandCard, EditCard, RanRow } from "@/components/mission/tool-cards";
import { ToolRun } from "@/components/mission/tool-group";
import { Callout } from "@/components/ui/callout";
import { Markdown } from "@/components/ui/markdown";
import { todoProgress } from "@/lib/mission/overview";
import { goalRequestId } from "@/lib/mission/queue";
import { transcriptRows } from "@/lib/mission/timeline";
import type { TimelineEntry } from "@/lib/mission/timeline";
import { markFirstOutput } from "@/lib/perf-marks";

/** Paper user bubble: right-aligned, 480px max, overlay surface. */
export const UserMessage = ({
  text,
  requestId,
}: {
  text: string;
  requestId?: string | null;
}) => {
  const { live, missionId } = useMission();
  const attachments = requestId
    ? (live.queue[requestId]?.attachments ?? [])
    : [];
  return (
    <div className="max-w-120 self-end rounded-md bg-surface-overlay px-card py-control">
      <p className="max-w-prose text-sm leading-chat font-book tracking-tight text-pretty break-words whitespace-pre-wrap text-text select-text">
        {text}
      </p>
      {attachments.length ? (
        <ul
          aria-label="Message attachments"
          className="flex flex-wrap gap-sm pt-sm"
        >
          {attachments.map((attachment) => (
            <li key={attachment.id}>
              <AttachmentPreview
                attachment={attachment}
                missionId={missionId}
              />
            </li>
          ))}
        </ul>
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
  const todos = todoProgress(live.todos, live.agents).total;
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

/** A streaming preview; its first paint is a performance mark. */
const Preview = ({
  entry,
}: {
  entry: Extract<TimelineEntry, { kind: "preview" }>;
}) => {
  const { id, previewKind, text } = entry;
  useEffect(() => markFirstOutput(previewKind, id), [id, previewKind]);
  return previewKind === "thinking" ? (
    <Thinking streaming text={text} />
  ) : (
    <Markdown className="max-w-prose" streaming>
      {text}
    </Markdown>
  );
};

const EntryBody = ({ entry }: { entry: TimelineEntry }) => {
  switch (entry.kind) {
    case "user": {
      return (
        <UserMessage requestId={entry.item.requestId} text={entry.item.text} />
      );
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
      return <Preview entry={entry} />;
    }
    case "agent_message": {
      return <AgentMessages items={[entry.item]} />;
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
  const { missionId } = useMission();
  const rows = transcriptRows(entries, running);
  return (
    <ol aria-label="Mission transcript" className="flex flex-col gap-lg">
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
        if (row.kind === "messages") {
          return (
            <li className="flex min-w-0 flex-col" key={row.id}>
              <AgentMessages items={row.items} />
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
          <li className="flex min-w-0 flex-col gap-lg" key={row.id}>
            <EntryBody entry={entry} />
            {goal ? <WorkspaceLine /> : null}
          </li>
        );
      })}
    </ol>
  );
};
